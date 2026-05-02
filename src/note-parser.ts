import { clip } from "./preview.js";
import { normalizeText } from "./query-profile.js";
import type { DegradedSignal, DuplicateHeadingWarning, HeadingContextRef, HeadingSummary, MarkdownLinkMetadata, WikiLinkMetadata } from "./retrieval-types.js";

export interface ParseMarkdownNoteOptions {
  previewChars?: number | undefined;
}

export interface ParsedHeading extends HeadingContextRef {
  normalizedHeading: string;
}

export interface ParsedMarkdownSection {
  index: number;
  heading?: string | undefined;
  headingLevel?: number | undefined;
  startLine: number;
  endLine: number;
  text: string;
  parentHeadings: HeadingContextRef[];
  childHeadings: HeadingContextRef[];
  duplicateHeadingWarning?: DuplicateHeadingWarning | undefined;
}

export interface ParsedMarkdownNote {
  noteType?: string | undefined;
  frontmatterKeys: string[];
  headings: HeadingSummary[];
  firstHeading?: HeadingSummary | undefined;
  duplicateHeadingWarnings: DuplicateHeadingWarning[];
  outgoingWikiLinks: WikiLinkMetadata[];
  outgoingMarkdownLinks: MarkdownLinkMetadata[];
  approximateCharCount: number;
  approximateLineCount: number;
  preview?: string | undefined;
  warnings: string[];
  degradedSignals: DegradedSignal[];
  sections: ParsedMarkdownSection[];
}

interface FrontmatterParseResult {
  keys: string[];
  values: Map<string, string>;
  endLineExclusive: number;
  malformed: boolean;
}

interface HeadingWithIndex extends ParsedHeading {
  index: number;
}

const DEGRADED_ORDER: DegradedSignal[] = ["metadata", "properties", "recents", "relationships", "backlinks", "parsing", "preview", "budget"];

export function parseMarkdownNote(content: string, options: ParseMarkdownNoteOptions = {}): ParsedMarkdownNote {
  const warnings: string[] = [];
  const degradedSignals = new Set<DegradedSignal>();
  const lines = content.split(/\r?\n/);
  const frontmatter = parseFrontmatter(lines);
  if (frontmatter.malformed) {
    warnings.push("Top-of-file frontmatter could not be fully parsed; frontmatter metadata may be incomplete.");
    degradedSignals.add("metadata");
    degradedSignals.add("parsing");
  }

  const headings = extractHeadings(lines);
  const duplicateHeadingWarnings = duplicateWarningsFor(headings);
  const duplicateByNormalized = new Map(duplicateHeadingWarnings.map((warning) => [warning.normalizedHeading, warning]));
  const outgoingWikiLinks = extractWikiLinks(lines);
  const outgoingMarkdownLinks = extractMarkdownLinks(lines);
  const sections = buildSections(lines, headings, duplicateByNormalized);
  const result: ParsedMarkdownNote = {
    frontmatterKeys: frontmatter.keys,
    headings: headings.map(toHeadingSummary),
    duplicateHeadingWarnings,
    outgoingWikiLinks,
    outgoingMarkdownLinks,
    approximateCharCount: content.length,
    approximateLineCount: lines.length,
    warnings: sortWarnings(warnings),
    degradedSignals: sortDegradedSignals([...degradedSignals]),
    sections,
  };
  const noteType = detectNoteType(frontmatter.values);
  if (noteType) result.noteType = noteType;
  const firstHeading = result.headings[0];
  if (firstHeading) result.firstHeading = firstHeading;
  if (options.previewChars !== undefined && options.previewChars > 0) {
    const preview = clip(content, options.previewChars);
    if (preview) result.preview = preview;
    if (preview.length < content.replace(/\s+/g, " ").trim().length) {
      result.warnings = sortWarnings([...result.warnings, "Note preview was clipped to the selected retrieval budget."]);
      result.degradedSignals = sortDegradedSignals([...result.degradedSignals, "preview", "budget"]);
    }
  }
  return result;
}

export function normalizeHeadingText(value: string): string {
  return normalizeText(value);
}

export function sortDegradedSignals(values: DegradedSignal[]): DegradedSignal[] {
  const set = new Set(values);
  return DEGRADED_ORDER.filter((signal) => set.has(signal));
}

export function sortWarnings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function parseFrontmatter(lines: string[]): FrontmatterParseResult {
  const values = new Map<string, string>();
  const keys: string[] = [];
  if ((lines[0] ?? "").trim() !== "---") return { keys, values, endLineExclusive: 0, malformed: false };
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) return { keys, values, endLineExclusive: lines.length, malformed: true };
  for (let index = 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] ?? "";
    if (!key) continue;
    if (!keys.includes(key)) keys.push(key);
    values.set(key, (match[2] ?? "").trim());
  }
  return { keys, values, endLineExclusive: end + 1, malformed: false };
}

function detectNoteType(values: Map<string, string>): string | undefined {
  for (const key of ["noteType", "type", "kind"]) {
    const value = values.get(key)?.trim();
    if (!value || value.startsWith("[") || value.startsWith("{") || value.includes("#")) continue;
    return value.replace(/^['\"]|['\"]$/g, "").trim() || undefined;
  }
  return undefined;
}

function extractHeadings(lines: string[]): HeadingWithIndex[] {
  const headings: HeadingWithIndex[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = (match[2] ?? "").trim();
    if (!text) continue;
    const level = match[1]?.length ?? 1;
    const lineNumber = index + 1;
    headings.push({ index: headings.length, text, level, line: lineNumber, normalizedHeading: normalizeHeadingText(text) });
  }
  return headings;
}

function toHeadingSummary(heading: HeadingWithIndex): HeadingSummary {
  return { text: heading.text, level: heading.level, line: heading.line };
}

function duplicateWarningsFor(headings: HeadingWithIndex[]): DuplicateHeadingWarning[] {
  const grouped = new Map<string, HeadingWithIndex[]>();
  for (const heading of headings) {
    if (!heading.normalizedHeading) continue;
    const list = grouped.get(heading.normalizedHeading) ?? [];
    list.push(heading);
    grouped.set(heading.normalizedHeading, list);
  }
  const warnings: DuplicateHeadingWarning[] = [];
  for (const [key, list] of grouped.entries()) {
    if (list.length <= 1) continue;
    const first = list[0]!;
    warnings.push({
      heading: first.text,
      normalizedHeading: key,
      occurrences: list.length,
      lines: list.map((heading) => heading.line ?? 0).filter((line) => line > 0),
      message: `Heading "${first.text}" appears ${list.length} times; section targeting may be ambiguous.`,
    });
  }
  return warnings.sort((a, b) => {
    const aDuplicateLine = a.lines[1] ?? a.lines[0] ?? Number.MAX_SAFE_INTEGER;
    const bDuplicateLine = b.lines[1] ?? b.lines[0] ?? Number.MAX_SAFE_INTEGER;
    if (aDuplicateLine !== bDuplicateLine) return aDuplicateLine - bDuplicateLine;
    return a.normalizedHeading.localeCompare(b.normalizedHeading);
  });
}

function extractWikiLinks(lines: string[]): WikiLinkMetadata[] {
  const links: WikiLinkMetadata[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const regex = /(!)?\[\[([^\]\n]+)\]\]/g;
    for (const match of line.matchAll(regex)) {
      const raw = (match[2] ?? "").trim();
      if (!raw) continue;
      const [targetPart = "", alias] = raw.split("|");
      const anchorIndex = targetPart.search(/[#^]/);
      const target = (anchorIndex >= 0 ? targetPart.slice(0, anchorIndex) : targetPart).trim();
      const anchor = anchorIndex >= 0 ? targetPart.slice(anchorIndex).trim() : undefined;
      const item: WikiLinkMetadata = { raw, target: target || targetPart.trim(), embed: Boolean(match[1]), line: index + 1 };
      if (alias?.trim()) item.alias = alias.trim();
      if (anchor) item.anchor = anchor;
      links.push(item);
    }
  }
  return links;
}

function extractMarkdownLinks(lines: string[]): MarkdownLinkMetadata[] {
  const links: MarkdownLinkMetadata[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const regex = /(!)?\[([^\]\n]*)\]\(([^)\s]+)(?:\s+(['\"])(.*?)\4)?\)/g;
    for (const match of line.matchAll(regex)) {
      const target = (match[3] ?? "").trim();
      if (!target) continue;
      const text = match[2] ?? "";
      const item: MarkdownLinkMetadata = { text, target, isImage: Boolean(match[1]), isExternal: isExternalTarget(target), line: index + 1 };
      const title = match[5]?.trim();
      if (title) item.title = title;
      links.push(item);
    }
  }
  return links;
}

function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

function buildSections(lines: string[], headings: HeadingWithIndex[], duplicates: Map<string, DuplicateHeadingWarning>): ParsedMarkdownSection[] {
  if (headings.length === 0) {
    const text = lines.join("\n").trim();
    return text ? [{ index: 0, startLine: 1, endLine: lines.length, text, parentHeadings: [], childHeadings: [] }] : [];
  }

  const parentByIndex = new Map<number, HeadingContextRef[]>();
  const childrenByIndex = new Map<number, HeadingContextRef[]>();
  const stack: HeadingWithIndex[] = [];
  for (const heading of headings) {
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
    parentByIndex.set(heading.index, stack.map(toHeadingContext));
    const parent = stack.at(-1);
    if (parent) {
      const children = childrenByIndex.get(parent.index) ?? [];
      children.push(toHeadingContext(heading));
      childrenByIndex.set(parent.index, children);
    }
    stack.push(heading);
  }

  const sections: ParsedMarkdownSection[] = [];
  const firstHeadingLine = headings[0]?.line ?? 1;
  const preludeText = lines.slice(0, Math.max(0, firstHeadingLine - 1)).join("\n").trim();
  if (preludeText) sections.push({ index: sections.length, startLine: 1, endLine: firstHeadingLine - 1, text: preludeText, parentHeadings: [], childHeadings: [] });

  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i]!;
    const nextHeading = headings[i + 1];
    const startLine = heading.line ?? 1;
    const endLine = nextHeading?.line ? nextHeading.line - 1 : lines.length;
    const text = lines.slice(startLine - 1, endLine).join("\n").trim();
    const section: ParsedMarkdownSection = {
      index: sections.length,
      heading: heading.text,
      headingLevel: heading.level,
      startLine,
      endLine,
      text,
      parentHeadings: parentByIndex.get(heading.index) ?? [],
      childHeadings: childrenByIndex.get(heading.index) ?? [],
    };
    const duplicate = duplicates.get(heading.normalizedHeading);
    if (duplicate) section.duplicateHeadingWarning = duplicate;
    sections.push(section);
  }
  return sections;
}

function toHeadingContext(heading: HeadingWithIndex): HeadingContextRef {
  const ref: HeadingContextRef = { text: heading.text, level: heading.level };
  if (heading.line !== undefined) ref.line = heading.line;
  return ref;
}
