import path from "node:path";
import { PathSafetyError } from "./errors.js";
import { parseMarkdownNote, normalizeHeadingText, sortWarnings as sortParserWarnings } from "./note-parser.js";
import { normalizeExplicitMarkdownNotePath } from "./path-safety.js";
import { clip } from "./preview.js";
import type { BudgetProfile } from "./retrieval-types.js";
import type { ValidationBuildOptions, ValidationCheckedScope, ValidationDegradedSignal, ValidationError, ValidationIssue, ValidationIssueCode, ValidationIssueLocation, ValidationIssueSeverity, ValidationMetadata, ValidationSummary } from "./validation-types.js";

const BUDGET_ISSUE_CAPS: Record<BudgetProfile, number> = { tiny: 10, standard: 25, expanded: 50 };
const MAX_ISSUES_SCHEMA_LIMIT = 100;
const OVERSIZED_CONTENT_CHARS = 100_000;
const VERY_LONG_LINE_CHARS = 8_000;
const LARGE_CODE_FENCE_CHARS = 12_000;
const EMBEDDED_BLOB_CHARS = 1_200;

const SEVERITY_RANK: Record<ValidationIssueSeverity, number> = { error: 0, warning: 1, info: 2 };
const DEGRADED_ORDER: ValidationDegradedSignal[] = ["parsing", "budget", "issues_truncated", "content_size", "validation_scope"];

export function validateMarkdownContent(content: string, options: ValidationBuildOptions = {}): ValidationMetadata {
  const checkedScope = options.checkedScope ?? "proposed_content";
  const { issues, warnings, degradedSignals } = collectValidationFindings(content, { expectedPath: options.expectedPath, checkedScope, extraWarnings: options.extraWarnings, extraDegradedSignals: options.extraDegradedSignals });
  return buildValidationMetadata(issues, { ...options, checkedScope, warnings, degradedSignals });
}

export function collectValidationFindings(content: string, options: { expectedPath?: string | undefined; checkedScope?: ValidationCheckedScope | undefined; extraWarnings?: string[] | undefined; extraDegradedSignals?: ValidationDegradedSignal[] | undefined } = {}): { issues: ValidationIssue[]; warnings: string[]; degradedSignals: ValidationDegradedSignal[] } {
  const parsed = parseMarkdownNote(content);
  const issues: ValidationIssue[] = [];
  const warnings = [...(options.extraWarnings ?? [])];
  const degradedSignals: ValidationDegradedSignal[] = [...(options.extraDegradedSignals ?? [])];
  const lines = content.split(/\r?\n/);

  for (const warning of parsed.warnings) {
    if (/frontmatter/i.test(warning)) degradedSignals.push("parsing");
  }

  if (parsed.frontmatter) {
    if (!parsed.frontmatter.hasClosingDelimiter) {
      issues.push(issue("FRONTMATTER_MISSING_CLOSING_DELIMITER", "error", "Frontmatter appears to start but no closing delimiter was found.", { line: parsed.frontmatter.startLine }));
      degradedSignals.push("parsing");
    } else {
      if (parsed.frontmatter.nonObject) {
        issues.push(issue("FRONTMATTER_NON_OBJECT", "error", "Frontmatter appears to be a list or scalar instead of object-like key/value metadata.", { line: parsed.frontmatter.startLine }));
        degradedSignals.push("parsing");
      }
      if (parsed.frontmatter.malformed) {
        issues.push(issue("FRONTMATTER_PARSE_ERROR", "error", "Frontmatter contains malformed key/value syntax that may confuse agents.", { line: parsed.frontmatter.startLine }));
        degradedSignals.push("parsing");
      }
      for (const duplicate of parsed.frontmatter.duplicateKeys) {
        issues.push(issue("FRONTMATTER_DUPLICATE_KEY", "warning", `Frontmatter key "${clipSafe(duplicate.key)}" appears more than once and later values may be ambiguous.`, { line: duplicate.line, frontmatterKey: clipSafe(duplicate.key) }));
      }
    }
  }

  if (parsed.headings.length === 0) {
    issues.push(issue("MISSING_FIRST_HEADING", "info", "No Markdown heading was found; this is informational and not a workflow error."));
  }

  for (const duplicate of parsed.duplicateHeadingWarnings) {
    const duplicateLine = duplicate.lines[1] ?? duplicate.lines[0];
    issues.push(issue("DUPLICATE_HEADING", "warning", `Heading "${clipSafe(duplicate.heading)}" appears more than once and may make agent edits ambiguous.`, { line: duplicateLine, heading: clipSafe(duplicate.heading) }));
  }

  for (let index = 0; index < parsed.headings.length; index += 1) {
    const heading = parsed.headings[index]!;
    const previous = parsed.headings[index - 1];
    const previousLevel = previous?.level ?? 0;
    const level = heading.level ?? 1;
    if (level > previousLevel + 1) {
      issues.push(issue("HEADING_LEVEL_JUMP", "warning", "Heading level jumps by more than one level and may be harder for agents to navigate.", { line: heading.line, heading: clipSafe(heading.text) }));
    }
  }

  for (const section of parsed.sections) {
    if (!section.heading || section.headingLevel === undefined) continue;
    const bodyLines = lines.slice(section.startLine, section.endLine).filter((line) => line.trim() !== "");
    if (bodyLines.length === 0) {
      issues.push(issue("EMPTY_SECTION", "info", `Section "${clipSafe(section.heading)}" has no body content before the next heading.`, { line: section.startLine, heading: clipSafe(section.heading) }));
    }
  }

  issues.push(...malformedMarkdownLinkIssues(lines));
  issues.push(...suspiciousPathIssues(lines));
  issues.push(...sizeIssues(content, lines, degradedSignals));
  issues.push(...wordingIssues(lines));

  if (options.expectedPath && parsed.firstHeading) {
    const expectedTitle = path.posix.basename(options.expectedPath, path.posix.extname(options.expectedPath));
    if (normalizeHeadingText(parsed.firstHeading.text) !== normalizeHeadingText(expectedTitle)) {
      issues.push(issue("TITLE_PATH_MISMATCH", "warning", "The first heading appears to differ from the safe expected path basename.", { line: parsed.firstHeading.line, heading: clipSafe(parsed.firstHeading.text) }));
    }
  }

  return { issues: sortValidationIssues(issues), warnings: sortValidationWarnings(warnings), degradedSignals: sortValidationDegradedSignals(degradedSignals) };
}

export function buildValidationMetadata(issues: ValidationIssue[], options: ValidationBuildOptions & { warnings?: string[] | undefined; degradedSignals?: ValidationDegradedSignal[] | undefined } = {}): ValidationMetadata {
  const checkedScope = options.checkedScope ?? "proposed_content";
  const budget = options.budget ?? "standard";
  const budgetCap = BUDGET_ISSUE_CAPS[budget];
  const maxIssues = options.maxIssues ?? budgetCap;
  const cap = Math.max(0, Math.min(maxIssues, budgetCap));
  const sortedIssues = sortValidationIssues(issues);
  const returnedIssues = sortedIssues.slice(0, cap);
  const omittedIssueCount = Math.max(0, sortedIssues.length - returnedIssues.length);
  const warnings = [...(options.warnings ?? []), ...(options.extraWarnings ?? [])];
  const degradedSignals = [...(options.degradedSignals ?? []), ...(options.extraDegradedSignals ?? [])];
  if (omittedIssueCount > 0) {
    warnings.push(`Validation omitted ${omittedIssueCount} issue${omittedIssueCount === 1 ? "" : "s"} to fit the selected issue cap or budget.`);
    degradedSignals.push("issues_truncated");
    if (sortedIssues.length > budgetCap || cap === budgetCap) degradedSignals.push("budget");
  }
  const summary = buildValidationSummary(sortedIssues, returnedIssues.length, omittedIssueCount, checkedScope);
  return {
    target: "proposed_content",
    ...(options.expectedPath ? { expectedPath: options.expectedPath } : {}),
    valid: summary.valid,
    issueCount: sortedIssues.length,
    issues: returnedIssues,
    warnings: sortValidationWarnings(warnings),
    degradedSignals: sortValidationDegradedSignals(degradedSignals),
    summary,
  };
}

export function buildValidationSummary(issues: ValidationIssue[], returnedIssueCount: number, omittedIssueCount: number, checkedScope: ValidationCheckedScope): ValidationSummary {
  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter((item) => item.severity === "warning").length;
  const infoCount = issues.filter((item) => item.severity === "info").length;
  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    returnedIssueCount,
    omittedIssueCount,
    highestSeverity: errorCount > 0 ? "error" : warningCount > 0 ? "warning" : infoCount > 0 ? "info" : "none",
    workflowNeutral: true,
    checkedScope,
  };
}

export function sortValidationIssues(values: ValidationIssue[]): ValidationIssue[] {
  return [...values].sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;
    const line = (a.location?.line ?? Number.MAX_SAFE_INTEGER) - (b.location?.line ?? Number.MAX_SAFE_INTEGER);
    if (line !== 0) return line;
    const context = issueContextKey(a).localeCompare(issueContextKey(b));
    if (context !== 0) return context;
    const code = a.code.localeCompare(b.code);
    if (code !== 0) return code;
    return a.message.localeCompare(b.message);
  });
}

export function sortValidationWarnings(values: string[]): string[] {
  return sortParserWarnings(values);
}

export function sortValidationDegradedSignals(values: ValidationDegradedSignal[]): ValidationDegradedSignal[] {
  const set = new Set(values);
  return DEGRADED_ORDER.filter((signal) => set.has(signal));
}

export function normalizeValidationExpectedPath(value: unknown): { ok: true; path?: string | undefined } | { ok: false; error: ValidationError; status: "validation_error" | "safety_refusal"; warning: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string") {
    return { ok: false, status: "validation_error", error: validationError("EXPECTED_PATH_NOT_STRING", "validation", "Provide expectedPath as one safe vault-relative Markdown path string."), warning: "Non-string expectedPath refused; no path-aware validation was performed." };
  }
  if (!value.trim()) {
    return { ok: false, status: "validation_error", error: validationError("UNSAFE_EXPECTED_PATH", "validation", "Provide a non-empty safe vault-relative Markdown expectedPath."), warning: "Empty expectedPath refused; no path-aware validation was performed." };
  }
  try {
    return { ok: true, path: normalizeExplicitMarkdownNotePath(value) };
  } catch (error) {
    return mapPathError(error, "expectedPath");
  }
}

export function normalizeValidationNotePath(value: unknown): { ok: true; path: string } | { ok: false; error: ValidationError; status: "validation_error" | "safety_refusal"; warning: string } {
  if (typeof value !== "string") {
    return { ok: false, status: "validation_error", error: validationError(value === undefined ? "MISSING_PATH" : "PATH_NOT_STRING", "validation", "Provide path as one explicit safe vault-relative Markdown path string."), warning: value === undefined ? "Missing validation path; no note was read." : "Non-string validation path refused; no note was read." };
  }
  if (!value.trim()) {
    return { ok: false, status: "validation_error", error: validationError("MISSING_PATH", "validation", "Provide one explicit safe vault-relative Markdown path."), warning: "Empty validation path refused; no note was read." };
  }
  try {
    return { ok: true, path: normalizeExplicitMarkdownNotePath(value) };
  } catch (error) {
    return mapPathError(error, "path");
  }
}

export function normalizeValidationMaxIssues(value: unknown): { ok: true; maxIssues?: number | undefined } | { ok: false; error: ValidationError; warning: string } {
  if (value === undefined) return { ok: true };
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_ISSUES_SCHEMA_LIMIT) {
    return { ok: false, error: validationError("INVALID_MAX_ISSUES", "validation", `Provide maxIssues as an integer from 1 to ${MAX_ISSUES_SCHEMA_LIMIT}.`), warning: "Invalid maxIssues refused; no content was validated." };
  }
  return { ok: true, maxIssues: value as number };
}

export function validationError(code: ValidationError["code"], category: ValidationError["category"], message: string, recoverable = true): ValidationError {
  return { code, category, message, recoverable };
}

function mapPathError(error: unknown, field: "path" | "expectedPath"): { ok: false; error: ValidationError; status: "validation_error" | "safety_refusal"; warning: string } {
  const expected = field === "expectedPath";
  if (error instanceof PathSafetyError && (error.code === "NON_MARKDOWN" || error.code === "EMPTY_PATH")) {
    const code = expected ? (error.code === "NON_MARKDOWN" ? "EXPECTED_PATH_NOT_MARKDOWN" : "UNSAFE_EXPECTED_PATH") : (error.code === "NON_MARKDOWN" ? "NOTE_NOT_MARKDOWN" : "MISSING_PATH");
    return {
      ok: false,
      status: "validation_error",
      error: validationError(code, "validation", expected ? "Provide expectedPath as one safe vault-relative Markdown .md path." : "Provide one explicit safe vault-relative Markdown .md path."),
      warning: expected ? "Invalid expectedPath refused; no path-aware validation was performed." : "Invalid validation path refused; no note was read.",
    };
  }
  return {
    ok: false,
    status: "safety_refusal",
    error: validationError(expected ? "UNSAFE_EXPECTED_PATH" : "UNSAFE_PATH", "safety", expected ? "Provide expectedPath without absolute, traversal, hidden, .obsidian, wildcard, recursive, or bulk/list syntax." : "Provide one explicit safe vault-relative Markdown path without absolute, traversal, hidden, .obsidian, wildcard, recursive, or bulk/list syntax."),
    warning: expected ? "Unsafe expectedPath refused; no content was validated." : "Unsafe validation path refused; no note was read.",
  };
}

function issue(code: ValidationIssueCode, severity: ValidationIssueSeverity, message: string, location?: ValidationIssueLocation | undefined): ValidationIssue {
  const item: ValidationIssue = { code, severity, message };
  if (location && Object.values(location).some((value) => value !== undefined)) item.location = location;
  return item;
}

function malformedMarkdownLinkIssues(lines: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/\[[^\]\n]*\]\([^)]*$/.test(line) || /\[[^\]\n]*\]\(\s*\)/.test(line) || /\[[^\]\n]*$/.test(line)) {
      issues.push(issue("MALFORMED_MARKDOWN_LINK", "error", "Malformed Markdown link-like syntax was detected and may not be interpreted safely.", { line: index + 1 }));
    }
  }
  return issues;
}

function suspiciousPathIssues(lines: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const candidates = pathCandidates(line);
    for (const candidate of candidates) {
      const code = suspiciousPathCode(candidate.target);
      if (!code) continue;
      const key = `${code}:${lineNumber}:${candidate.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issue(code, "warning", suspiciousPathMessage(code), { line: lineNumber, linkText: redactedPathLikeSnippet(candidate.label) }));
    }
  }
  return issues;
}

function pathCandidates(line: string): Array<{ target: string; label: string }> {
  const candidates: Array<{ target: string; label: string }> = [];
  for (const match of line.matchAll(/!?\[([^\]\n]*)\]\(([^)\s]+)(?:\s+(['"])(.*?)\3)?\)/g)) {
    const label = (match[1] ?? "").trim() || "Markdown link";
    candidates.push({ target: match[2] ?? "", label });
  }
  for (const match of line.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
    const raw = (match[1] ?? "").trim();
    const [target = "", alias] = raw.split("|");
    candidates.push({ target, label: alias?.trim() || target });
  }
  for (const match of line.matchAll(/(?:^|\s)(\.\.\/[\S]+|\/[A-Za-z0-9._~/-]+|[A-Za-z]:\\[^\s)]+|\\\\[^\s)]+|\.obsidian\/[\S]+)/g)) {
    const raw = (match[1] ?? "").trim();
    candidates.push({ target: raw, label: raw });
  }
  return candidates;
}

function suspiciousPathCode(value: string): ValidationIssueCode | undefined {
  const target = decodePathLike(value).replace(/\\+/g, "/");
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[A-Za-z]:\//.test(target)) return undefined;
  if (/^[A-Za-z]:\//.test(target)) return "SUSPICIOUS_WINDOWS_ABSOLUTE_PATH";
  if (target.startsWith("//")) return "SUSPICIOUS_UNC_PATH";
  if (target.startsWith("/")) return "SUSPICIOUS_ABSOLUTE_PATH";
  if (/(^|\/)\.\.($|\/)/.test(target)) return "SUSPICIOUS_TRAVERSAL_PATH";
  if (/(^|\/)\.obsidian($|\/)/i.test(target)) return "SUSPICIOUS_OBSIDIAN_PATH";
  return undefined;
}

function suspiciousPathMessage(code: ValidationIssueCode): string {
  switch (code) {
    case "SUSPICIOUS_WINDOWS_ABSOLUTE_PATH": return "Windows absolute-looking path-like content was detected and should be reviewed before writing.";
    case "SUSPICIOUS_UNC_PATH": return "UNC-looking path-like content was detected and should be reviewed before writing.";
    case "SUSPICIOUS_ABSOLUTE_PATH": return "Absolute-looking path-like content was detected and should be reviewed before writing.";
    case "SUSPICIOUS_OBSIDIAN_PATH": return ".obsidian-looking path-like content was detected and should be reviewed before writing.";
    case "SUSPICIOUS_TRAVERSAL_PATH": return "Traversal-looking path-like content was detected and should be reviewed before writing.";
    default: return "Suspicious path-like content was detected and should be reviewed before writing.";
  }
}

function sizeIssues(content: string, lines: string[], degradedSignals: ValidationDegradedSignal[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (content.length > OVERSIZED_CONTENT_CHARS || lines.some((line) => line.length > VERY_LONG_LINE_CHARS)) {
    issues.push(issue("OVERSIZED_CONTENT", "warning", "Content is large; validation details were bounded and full content was not returned."));
    degradedSignals.push("content_size");
  }
  let fenceStart = -1;
  let fenceChars = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^```/.test(line.trim())) {
      if (fenceStart >= 0) {
        if (fenceChars > LARGE_CODE_FENCE_CHARS) {
          issues.push(issue("LARGE_CODE_FENCE", "warning", "A large code fence was detected; full code content was not returned.", { line: fenceStart + 1 }));
          degradedSignals.push("content_size");
        }
        fenceStart = -1;
        fenceChars = 0;
      } else {
        fenceStart = index;
        fenceChars = 0;
      }
    } else if (fenceStart >= 0) fenceChars += line.length + 1;

    if (/data:[^\s,;]+;base64,[A-Za-z0-9+/=]{200,}/.test(line) || /[A-Za-z0-9+/]{1200,}={0,2}/.test(line)) {
      issues.push(issue("EMBEDDED_BLOB", "warning", "Large embedded blob-like content was detected; full blob content was not returned.", { line: index + 1 }));
      degradedSignals.push("content_size");
    }
  }
  if (fenceStart >= 0 && fenceChars > LARGE_CODE_FENCE_CHARS) {
    issues.push(issue("LARGE_CODE_FENCE", "warning", "A large code fence was detected; full code content was not returned.", { line: fenceStart + 1 }));
    degradedSignals.push("content_size");
  }
  return issues;
}

function wordingIssues(lines: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/\b(full|entire|all)\s+(vault|folder|note|notes)|\bdump\s+(the\s+)?(vault|folder|all\s+notes)|\blist\s+every\s+note/i.test(line)) {
      issues.push(issue("BROAD_DUMP_WORDING", "warning", "Broad-dump wording was detected as advisory content only; no broad access is executed.", { line: index + 1 }));
    }
    if (/\b(delete|remove|trash|move|copy|rename|rewrite|shell|network|curl|fetch|execute|command|open\s+obsidian)\b/i.test(line)) {
      issues.push(issue("UNSAFE_OPERATION_WORDING", "warning", "Unsafe-operation wording was detected as advisory content only; no operation is executed.", { line: index + 1 }));
    }
  }
  return issues;
}

function issueContextKey(issue: ValidationIssue): string {
  const location = issue.location;
  return [location?.heading, location?.frontmatterKey, location?.linkText, issue.path].filter(Boolean).join("\u0000");
}

function clipSafe(value: string): string {
  return clip(value, 80);
}

function redactedPathLikeSnippet(value: string): string {
  if (suspiciousPathCode(value)) return "path-like text";
  return clipSafe(value);
}

function decodePathLike(value: string): string {
  let current = value.trim();
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return decoded;
      current = decoded;
    } catch {
      return current;
    }
  }
  return current;
}
