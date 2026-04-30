import { clipEditPreview } from "./edit-guidance.js";
import type { EditPropertySummary, EditTransformResult } from "./edit-types.js";

export class FrontmatterEditError extends Error {
  constructor(message: string, public readonly code: "MISSING_VALUE" | "PROPERTY_NOT_FOUND" | "DUPLICATE_PROPERTY" | "MALFORMED_FRONTMATTER" | "EDIT_FAILED", public readonly details?: Record<string, unknown> | undefined) {
    super(message);
    this.name = "FrontmatterEditError";
  }
}

interface LineRecord {
  text: string;
  eol: string;
  start: number;
  lineEnd: number;
  end: number;
  lineNumber: number;
}

interface FrontmatterBlock {
  exists: boolean;
  openingEnd: number;
  contentStart: number;
  contentEnd: number;
  closingStart: number;
  end: number;
  lines: LineRecord[];
}

interface PropertySpan {
  name: string;
  line: number;
  start: number;
  end: number;
  raw: string;
}

export function planUpdateFrontmatter(content: string, property: string, value: unknown): EditTransformResult {
  const cleanProperty = normalizePropertyName(property);
  const serialized = serializeFrontmatterValue(value);
  const valueClip = clipEditPreview(serialized);
  const block = parseFrontmatterBlock(content);
  if (!block.exists) {
    const line = `${cleanProperty}: ${serialized}`;
    const contentAfter = `---\n${line}\n---\n${content}`;
    return {
      contentAfter,
      targetKind: "frontmatter",
      change: "set",
      property: { name: cleanProperty, line: 2 },
      afterPreview: line,
      valuePreview: valueClip.preview,
      valueType: valueType(value),
      previewTruncated: valueClip.truncated,
      bodyPreserved: true,
    };
  }

  const properties = findProperties(content, block);
  const matches = properties.filter((item) => item.name === cleanProperty);
  if (matches.length > 1) throw new FrontmatterEditError("More than one top-level frontmatter property matches the requested property.", "DUPLICATE_PROPERTY", { property: cleanProperty, count: matches.length, lines: matches.map((item) => item.line) });
  const line = `${cleanProperty}: ${serialized}${preferredEol(block.lines)}`;
  let contentAfter: string;
  let summary: EditPropertySummary;
  let beforePreview: string | undefined;
  if (matches.length === 1) {
    const match = matches[0]!;
    beforePreview = clipEditPreview(match.raw).preview;
    contentAfter = `${content.slice(0, match.start)}${line}${content.slice(match.end)}`;
    summary = { name: cleanProperty, line: match.line };
  } else {
    const prefix = needsFrontmatterContentSeparator(content, block) ? preferredEol(block.lines) : "";
    contentAfter = `${content.slice(0, block.contentEnd)}${prefix}${line}${content.slice(block.contentEnd)}`;
    summary = { name: cleanProperty, line: lineNumberAt(content, block.contentEnd) };
  }
  return {
    contentAfter,
    targetKind: "frontmatter",
    change: "set",
    property: summary,
    beforePreview,
    afterPreview: `${cleanProperty}: ${serialized}`,
    valuePreview: valueClip.preview,
    valueType: valueType(value),
    previewTruncated: valueClip.truncated,
    bodyPreserved: content.slice(block.end) === contentAfter.slice(findFrontmatterEnd(contentAfter)),
  };
}

export function planRemoveFrontmatter(content: string, property: string): EditTransformResult {
  const cleanProperty = normalizePropertyName(property);
  const block = parseFrontmatterBlock(content);
  if (!block.exists) throw new FrontmatterEditError("Top-of-file frontmatter does not contain the requested property.", "PROPERTY_NOT_FOUND", { property: cleanProperty });
  const properties = findProperties(content, block);
  const matches = properties.filter((item) => item.name === cleanProperty);
  if (matches.length === 0) throw new FrontmatterEditError("Top-of-file frontmatter does not contain the requested property.", "PROPERTY_NOT_FOUND", { property: cleanProperty });
  if (matches.length > 1) throw new FrontmatterEditError("More than one top-level frontmatter property matches the requested property.", "DUPLICATE_PROPERTY", { property: cleanProperty, count: matches.length, lines: matches.map((item) => item.line) });
  const match = matches[0]!;
  const contentAfter = `${content.slice(0, match.start)}${content.slice(match.end)}`;
  const beforeClip = clipEditPreview(match.raw);
  return {
    contentAfter,
    targetKind: "frontmatter",
    change: "remove",
    property: { name: cleanProperty, line: match.line },
    beforePreview: beforeClip.preview,
    afterPreview: "",
    previewTruncated: beforeClip.truncated,
    bodyPreserved: content.slice(block.end) === contentAfter.slice(findFrontmatterEnd(contentAfter)),
  };
}

function parseFrontmatterBlock(content: string): FrontmatterBlock {
  const lines = splitLines(content);
  const first = lines[0];
  if (!first || first.text.trim() !== "---") return { exists: false, openingEnd: 0, contentStart: 0, contentEnd: 0, closingStart: 0, end: 0, lines: [] };
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.text.trim() === "---" || line.text.trim() === "...") {
      return { exists: true, openingEnd: first.end, contentStart: first.end, contentEnd: line.start, closingStart: line.start, end: line.end, lines: lines.slice(1, index) };
    }
  }
  throw new FrontmatterEditError("Top-of-file frontmatter is malformed because no closing delimiter was found.", "MALFORMED_FRONTMATTER");
}

function findProperties(content: string, block: FrontmatterBlock): PropertySpan[] {
  const props: PropertySpan[] = [];
  const lines = block.lines;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^[\t ]/.test(line.text) || line.text.trim() === "" || line.text.trim().startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-][A-Za-z0-9_.-]*)\s*:/.exec(line.text);
    if (!match) continue;
    let end = line.end;
    for (let lookahead = index + 1; lookahead < lines.length; lookahead += 1) {
      const next = lines[lookahead]!;
      if (!/^[\t ]/.test(next.text) && /^([A-Za-z0-9_-][A-Za-z0-9_.-]*)\s*:/.test(next.text)) break;
      end = next.end;
      index = lookahead;
    }
    props.push({ name: match[1]!, line: line.lineNumber, start: line.start, end, raw: content.slice(line.start, end) });
  }
  return props;
}

function splitLines(content: string): LineRecord[] {
  const lines: LineRecord[] = [];
  let start = 0;
  let lineNumber = 1;
  while (start < content.length) {
    const newline = content.indexOf("\n", start);
    if (newline === -1) {
      lines.push({ text: content.slice(start), eol: "", start, lineEnd: content.length, end: content.length, lineNumber });
      break;
    }
    const lineEnd = newline > start && content[newline - 1] === "\r" ? newline - 1 : newline;
    const eol = content.slice(lineEnd, newline + 1);
    lines.push({ text: content.slice(start, lineEnd), eol, start, lineEnd, end: newline + 1, lineNumber });
    start = newline + 1;
    lineNumber += 1;
  }
  return lines;
}

function normalizePropertyName(property: string): string {
  const clean = property.trim();
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(clean)) throw new FrontmatterEditError("Frontmatter property must be a top-level YAML key name.", "EDIT_FAILED", { property: clean });
  return clean;
}

function serializeFrontmatterValue(value: unknown, seen = new Set<unknown>()): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FrontmatterEditError("Frontmatter value must be JSON-compatible.", "EDIT_FAILED");
    return String(value);
  }
  if (typeof value === "string") return serializeString(value);
  if (Array.isArray(value)) return `[${value.map((item) => serializeFrontmatterValue(item, seen)).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) throw new FrontmatterEditError("Frontmatter value must not contain cycles.", "EDIT_FAILED");
    seen.add(value);
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const serialized = `{ ${entries.map(([key, item]) => `${serializeObjectKey(key)}: ${serializeFrontmatterValue(item, seen)}`).join(", ")} }`;
    seen.delete(value);
    return serialized;
  }
  throw new FrontmatterEditError("Frontmatter value must be JSON-compatible.", "EDIT_FAILED");
}

function serializeString(value: string): string {
  if (value !== "" && /^[A-Za-z0-9 _./-]+$/.test(value) && !/^(true|false|null|[-+]?\d+(?:\.\d+)?)$/i.test(value) && value.trim() === value) return value;
  return JSON.stringify(value);
}

function serializeObjectKey(value: string): string {
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(value) ? value : JSON.stringify(value);
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function preferredEol(lines: LineRecord[]): string {
  return lines.find((line) => line.eol)?.eol ?? "\n";
}

function needsFrontmatterContentSeparator(content: string, block: FrontmatterBlock): boolean {
  if (block.contentEnd === block.contentStart) return false;
  return !content.slice(block.contentStart, block.contentEnd).endsWith("\n") && !content.slice(block.contentStart, block.contentEnd).endsWith("\r");
}

function lineNumberAt(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

function findFrontmatterEnd(content: string): number {
  try {
    return parseFrontmatterBlock(content).end;
  } catch {
    return 0;
  }
}
