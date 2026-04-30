import { clipEditPreview } from "./edit-guidance.js";
import type { EditHeadingSummary, EditTransformResult, ObsidianEditOperation } from "./edit-types.js";

export class MarkdownSectionEditError extends Error {
  constructor(message: string, public readonly code: "INVALID_HEADING" | "HEADING_NOT_FOUND" | "DUPLICATE_HEADING", public readonly details?: Record<string, unknown> | undefined) {
    super(message);
    this.name = "MarkdownSectionEditError";
  }
}

interface NormalizedHeading {
  level: number;
  text: string;
}

interface LineRecord {
  text: string;
  eol: string;
  start: number;
  lineEnd: number;
  end: number;
  lineNumber: number;
}

interface HeadingRecord extends NormalizedHeading {
  line: LineRecord;
}

export function normalizeMarkdownHeading(input: string): NormalizedHeading {
  const heading = parseHeadingLine(input.trimEnd());
  if (!heading) throw new MarkdownSectionEditError("Heading must be an exact ATX Markdown heading such as ## Plan.", "INVALID_HEADING");
  return heading;
}

export function planSectionTransform(content: string, operation: Extract<ObsidianEditOperation, "replace_section" | "insert_under_heading">, requestedHeading: string, suppliedContent: string): EditTransformResult {
  const target = normalizeMarkdownHeading(requestedHeading);
  const lines = splitLines(content);
  const headings = lines.map((line) => {
    const parsed = parseHeadingLine(line.text);
    return parsed ? { ...parsed, line } : undefined;
  }).filter((item): item is HeadingRecord => Boolean(item));
  const matches = headings.filter((heading) => heading.level === target.level && heading.text === target.text);
  if (matches.length === 0) throw new MarkdownSectionEditError("No Markdown heading matches the requested exact heading.", "HEADING_NOT_FOUND", { heading: headingText(target) });
  if (matches.length > 1) throw new MarkdownSectionEditError("More than one Markdown heading matches the requested exact heading.", "DUPLICATE_HEADING", { heading: headingText(target), count: matches.length, lines: matches.map((match) => match.line.lineNumber) });

  const match = matches[0]!;
  const nextBoundary = headings.find((heading) => heading.line.start > match.line.start && heading.level <= match.level);
  const bodyStart = match.line.end;
  const bodyEnd = nextBoundary?.line.start ?? content.length;
  const beforeBody = content.slice(bodyStart, bodyEnd);
  const headingSummary: EditHeadingSummary = { level: match.level, text: match.text, line: match.line.lineNumber };
  const beforeClip = clipEditPreview(beforeBody);

  if (operation === "replace_section") {
    const replacement = normalizeInsertedMarkdown(suppliedContent, content.slice(0, bodyStart), content.slice(bodyEnd));
    const contentAfter = `${content.slice(0, bodyStart)}${replacement}${content.slice(bodyEnd)}`;
    const afterClip = clipEditPreview(replacement);
    return {
      contentAfter,
      targetKind: "section",
      change: "replace",
      heading: headingSummary,
      beforePreview: beforeClip.preview,
      afterPreview: afterClip.preview,
      contentChars: suppliedContent.length,
      previewTruncated: beforeClip.truncated || afterClip.truncated,
    };
  }

  const insertion = normalizeInsertedMarkdown(suppliedContent, content.slice(0, bodyStart), content.slice(bodyStart));
  const contentAfter = `${content.slice(0, bodyStart)}${insertion}${content.slice(bodyStart)}`;
  const insertedClip = clipEditPreview(insertion);
  const afterClip = clipEditPreview(`${insertion}${beforeBody}`);
  return {
    contentAfter,
    targetKind: "section",
    change: "insert",
    heading: headingSummary,
    beforePreview: beforeClip.preview,
    afterPreview: afterClip.preview,
    insertedPreview: insertedClip.preview,
    contentChars: suppliedContent.length,
    previewTruncated: beforeClip.truncated || afterClip.truncated || insertedClip.truncated,
  };
}

function parseHeadingLine(line: string): NormalizedHeading | undefined {
  const match = /^(?: {0,3})(#{1,6})(?:[\t ]+|$)(.*)$/.exec(line);
  if (!match) return undefined;
  const marker = match[1] ?? "";
  let text = match[2] ?? "";
  text = text.replace(/[\t ]+#+[\t ]*$/u, "").trim();
  if (!text) return undefined;
  return { level: marker.length, text };
}

function splitLines(content: string): LineRecord[] {
  const lines: LineRecord[] = [];
  let start = 0;
  let lineNumber = 1;
  while (start < content.length) {
    const newline = content.indexOf("\n", start);
    if (newline === -1) {
      const text = content.slice(start);
      lines.push({ text, eol: "", start, lineEnd: content.length, end: content.length, lineNumber });
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

function normalizeInsertedMarkdown(markdown: string, before: string, after: string): string {
  let result = markdown;
  if (result.length > 0 && before.length > 0 && !endsWithLineBreak(before)) result = `\n${result}`;
  if (result.length > 0 && after.length > 0 && !endsWithLineBreak(result)) result = `${result}\n`;
  return result;
}

function endsWithLineBreak(value: string): boolean {
  return value.endsWith("\n") || value.endsWith("\r");
}

function headingText(heading: NormalizedHeading): string {
  return `${"#".repeat(heading.level)} ${heading.text}`;
}
