import path from "node:path";
import { PathSafetyError } from "./errors.js";
import { budgetForProfile } from "./context-packer.js";
import { normalizeExplicitMarkdownNotePath } from "./path-safety.js";
import { parseMarkdownNote, sortDegradedSignals, sortWarnings } from "./note-parser.js";
import type { AgentGuidance, BudgetConfig, BudgetProfile, DegradedSignal, DuplicateHeadingWarning, HeadingSummary, MarkdownLinkMetadata, ObsidianCliBackend, ObsidianRetrieveOutput, RetrievalRequest, RetrieveError, StructuredNextAction, WikiLinkMetadata } from "./retrieval-types.js";

export interface NoteInspectionOptions {
  defaultBudget?: BudgetProfile | undefined;
  budgetChars?: Partial<Record<BudgetProfile, number>> | undefined;
}

export async function inspectNote(backend: ObsidianCliBackend, request: RetrievalRequest, options: NoteInspectionOptions = {}): Promise<ObsidianRetrieveOutput> {
  const profile = request.budget ?? options.defaultBudget ?? "standard";
  const budget = budgetForProfile(profile, options.budgetChars);
  const rawPath = typeof request.path === "string" ? request.path : "";
  if (request.path !== undefined && typeof request.path !== "string") {
    return emptyInspectionOutput({
      status: "validation_error",
      profile,
      budget,
      message: "obsidian_retrieve mode=note requires path to be one explicit safe vault-relative Markdown string.",
      error: { code: "NOTE_PATH_NOT_STRING", category: "validation", message: "Provide exactly one safe vault-relative Markdown path string in the path field.", recoverable: true },
      warnings: ["Non-string note inspection path refused; no note was read."],
      action: "retry_with_path",
    });
  }
  if (!rawPath.trim()) {
    return emptyInspectionOutput({
      status: "validation_error",
      profile,
      budget,
      message: "obsidian_retrieve mode=note requires one explicit safe vault-relative Markdown path.",
      error: { code: "MISSING_PATH", category: "validation", message: "Provide one explicit safe vault-relative Markdown path in the path field.", recoverable: true },
      warnings: ["Missing note inspection path; no note was read."],
      action: "retry_with_path",
    });
  }

  if (request.selected !== undefined || request.scope !== undefined || request.maxCandidates !== undefined) {
    return emptyInspectionOutput({
      status: "validation_error",
      profile,
      budget,
      message: "obsidian_retrieve mode=note inspects exactly one path and does not accept selected candidates, scope, or maxCandidates.",
      error: { code: "NOTE_MODE_PATH_ONLY", category: "validation", message: "Use only mode=note with one explicit path; use context mode for selected refs and search/project modes for discovery.", recoverable: true },
      warnings: ["Note inspection path-only contract refused broad or multi-note fields; no note was read."],
      action: "retry_with_path",
    });
  }

  let safePath: string;
  try {
    safePath = normalizeExplicitMarkdownNotePath(rawPath);
  } catch (error) {
    const mapped = mapPathError(error);
    return emptyInspectionOutput({
      status: mapped.status,
      profile,
      budget,
      message: mapped.status === "validation_error" ? "The note inspection path is not a valid Markdown note path." : "The note inspection path is not safe for obsidian_retrieve mode=note.",
      error: mapped.error,
      warnings: [mapped.warning],
      action: "stop",
    });
  }

  let content: string;
  try {
    const read = await backend.read({ path: safePath });
    content = read.content;
  } catch {
    return emptyInspectionOutput({
      status: "not_found",
      profile,
      budget,
      path: safePath,
      message: `Note inspection could not find ${safePath}.`,
      error: { code: "NOTE_NOT_FOUND", category: "not_found", message: "The requested Markdown note does not exist or is not readable.", recoverable: true },
      warnings: ["The requested note was not found; no content was read or inferred."],
      action: "retry_with_path",
    });
  }

  const parsed = parseMarkdownNote(content, { previewChars: request.explain ? budget.previewChars : undefined });
  const warnings = [...parsed.warnings];
  const degradedSignals = [...parsed.degradedSignals];
  const frontmatterKeys = limitArray(parsed.frontmatterKeys, budget.metadataItems * 2, warnings, degradedSignals, "frontmatter keys");
  const headings = limitArray(parsed.headings, Math.max(12, budget.metadataItems * 4), warnings, degradedSignals, "headings");
  const duplicateHeadingWarnings = limitArray(parsed.duplicateHeadingWarnings, budget.metadataItems, warnings, degradedSignals, "duplicate heading warnings");
  const outgoingWikiLinks = limitArray(parsed.outgoingWikiLinks, budget.metadataItems, warnings, degradedSignals, "wiki links");
  const outgoingMarkdownLinks = limitArray(parsed.outgoingMarkdownLinks, budget.metadataItems, warnings, degradedSignals, "Markdown links");
  const firstHeading = parsed.firstHeading;
  const nextAction: StructuredNextAction = {
    priority: 1,
    action: "answer_from_metadata",
    label: "Use the returned structured note metadata before requesting edits or management operations.",
    params: { mode: "note", path: safePath },
  };
  const guidance = guidanceFor({ path: safePath, title: titleFromPath(safePath), action: nextAction, degradedSignals: sortDegradedSignals(degradedSignals), success: true });
  const output: ObsidianRetrieveOutput = {
    tool: "obsidian_retrieve",
    status: "success",
    mode: "note",
    query: request.query,
    path: safePath,
    exists: true,
    frontmatterKeys,
    headings,
    duplicateHeadingWarnings,
    outgoingWikiLinks,
    outgoingMarkdownLinks,
    approximateCharCount: parsed.approximateCharCount,
    approximateLineCount: parsed.approximateLineCount,
    candidates: [],
    budget: { profile, maxChars: budget.totalChars, usedChars: 0, truncated: false, omissions: [] },
    warnings: sortWarnings(warnings),
    degradedSignals: sortDegradedSignals(degradedSignals),
    nextActions: [nextAction.label],
    agentGuidance: guidance,
  };
  if (parsed.noteType) output.noteType = parsed.noteType;
  if (firstHeading) output.firstHeading = firstHeading;
  if (parsed.preview) (output as ObsidianRetrieveOutput & { preview?: string }).preview = parsed.preview;
  return fitInspectionOutput(output, budget.totalChars);
}

function emptyInspectionOutput(input: {
  status: NonNullable<ObsidianRetrieveOutput["status"]>;
  profile: BudgetProfile;
  budget: BudgetConfig;
  path?: string | undefined;
  message: string;
  error: RetrieveError;
  warnings: string[];
  action: "retry_with_path" | "stop";
}): ObsidianRetrieveOutput {
  const action: StructuredNextAction = input.action === "retry_with_path"
    ? { priority: 1, action: "retry_with_path", label: "Retry only after the user provides one existing safe vault-relative Markdown path." }
    : { priority: 1, action: "stop", label: "Do not retry until the request uses one explicit safe vault-relative Markdown path." };
  const guidance = guidanceFor({ path: input.path, title: input.path ? titleFromPath(input.path) : undefined, action, degradedSignals: [], success: false });
  const output: ObsidianRetrieveOutput = {
    tool: "obsidian_retrieve",
    status: input.status,
    mode: "note",
    exists: false,
    frontmatterKeys: [],
    headings: [],
    duplicateHeadingWarnings: [],
    outgoingWikiLinks: [],
    outgoingMarkdownLinks: [],
    approximateCharCount: 0,
    approximateLineCount: 0,
    candidates: [],
    budget: { profile: input.profile, maxChars: input.budget.totalChars, usedChars: 0, truncated: false, omissions: [] },
    warnings: sortWarnings(input.warnings),
    degradedSignals: [],
    nextActions: [action.label],
    agentGuidance: guidance,
    error: input.error,
  };
  if (input.path) output.path = input.path;
  return fitInspectionOutput(output, input.budget.totalChars);
}

function mapPathError(error: unknown): { status: "validation_error" | "safety_refusal"; error: RetrieveError; warning: string } {
  if (error instanceof PathSafetyError && (error.code === "NON_MARKDOWN" || error.code === "EMPTY_PATH")) {
    return {
      status: "validation_error",
      error: { code: error.code === "NON_MARKDOWN" ? "NOTE_NOT_MARKDOWN" : "MISSING_PATH", category: "validation", message: "Provide one explicit safe vault-relative Markdown .md path.", recoverable: true },
      warning: error.code === "NON_MARKDOWN" ? "Non-Markdown note inspection path refused; no note was read." : "Empty note inspection path refused; no note was read.",
    };
  }
  return {
    status: "safety_refusal",
    error: { code: "UNSAFE_PATH", category: "safety", message: "Provide one explicit safe vault-relative Markdown path without absolute, traversal, hidden, .obsidian, wildcard, recursive, or bulk/list syntax.", recoverable: true },
    warning: "Unsafe note inspection path refused; no note was read.",
  };
}

function limitArray<T>(values: T[], max: number, warnings: string[], degradedSignals: DegradedSignal[], label: string): T[] {
  if (values.length <= max) return values;
  warnings.push(`${label} were clipped to fit the selected retrieval budget.`);
  degradedSignals.push("budget");
  return values.slice(0, max);
}

function fitInspectionOutput(output: ObsidianRetrieveOutput, maxChars: number): ObsidianRetrieveOutput {
  let next = output;
  let used = JSON.stringify(next).length;
  const omissions = [...next.budget.omissions];
  if (used > maxChars && "preview" in next) {
    const { preview: _preview, ...rest } = next as ObsidianRetrieveOutput & { preview?: string };
    next = { ...rest, warnings: sortWarnings([...next.warnings, "Note preview omitted to fit the selected retrieval budget."]), degradedSignals: sortDegradedSignals([...(next.degradedSignals ?? []), "preview", "budget"]) };
    omissions.push("note preview omitted to fit response budget");
    used = JSON.stringify(next).length;
  }
  if (used > maxChars) {
    next = {
      ...next,
      headings: next.headings?.slice(0, 4),
      outgoingWikiLinks: next.outgoingWikiLinks?.slice(0, 2),
      outgoingMarkdownLinks: next.outgoingMarkdownLinks?.slice(0, 2),
      duplicateHeadingWarnings: next.duplicateHeadingWarnings?.slice(0, 2),
      warnings: sortWarnings([...next.warnings, "Low-priority note metadata clipped to fit response budget."]),
      degradedSignals: sortDegradedSignals([...(next.degradedSignals ?? []), "budget"]),
    };
    omissions.push("low-priority note metadata clipped to fit response budget");
    used = JSON.stringify(next).length;
  }
  const truncated = omissions.length > 0 || used > maxChars;
  return { ...next, budget: { ...next.budget, usedChars: Math.min(used, maxChars), truncated, omissions: [...new Set(omissions)] } };
}

function guidanceFor(input: { path?: string | undefined; title?: string | undefined; action: StructuredNextAction; degradedSignals: DegradedSignal[]; success: boolean }): AgentGuidance {
  return {
    resultState: input.success ? "answer_from_discovery" : "no_match",
    bestMatch: input.path ? {
      selectedRef: { path: input.path, ...(input.title ? { title: input.title } : {}) },
      rank: 1,
      path: input.path,
      title: input.title ?? titleFromPath(input.path),
      reason: input.success ? "Explicit note inspection returned structured metadata." : "Explicit note path was not inspectable.",
      topSignals: ["exact_file"],
    } : null,
    confidence: {
      level: input.success ? (input.degradedSignals.length > 0 ? "medium" : "high") : "none",
      ambiguous: false,
      rationale: input.success ? "The inspected note was identified by one explicit safe vault-relative Markdown path." : "No inspectable note was available for the requested explicit path.",
      ...(input.degradedSignals.length > 0 ? { degradedSignals: input.degradedSignals } : {}),
    },
    contextRecommendation: {
      recommended: false,
      reason: input.success ? "Structured note metadata is already returned; request context only if content excerpts are needed." : "No note context is recommended until the explicit path is corrected.",
      selected: input.path ? [{ path: input.path, ...(input.title ? { title: input.title } : {}) }] : [],
      mode: "none",
      answerScope: input.success ? "discovery_only" : "clarify_first",
    },
    alternatives: [],
    nextActions: [input.action],
  };
}

function titleFromPath(notePath: string): string {
  return path.posix.basename(notePath, path.posix.extname(notePath));
}
