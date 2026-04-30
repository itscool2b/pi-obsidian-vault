import { clipEditPreview } from "./edit-guidance.js";
import type { EditTransformResult } from "./edit-types.js";

const CONTEXT_CHARS = 500;

export class ExactTextEditError extends Error {
  constructor(message: string, public readonly code: "OLD_TEXT_NOT_FOUND" | "DUPLICATE_OLD_TEXT" | "FULL_NOTE_REPLACEMENT", public readonly details?: Record<string, unknown> | undefined) {
    super(message);
    this.name = "ExactTextEditError";
  }
}

export function planExactTextTransform(content: string, oldText: string, newText: string): EditTransformResult {
  const matches = findMatches(content, oldText);
  if (matches.length === 0) throw new ExactTextEditError("The requested oldText does not appear in the target note.", "OLD_TEXT_NOT_FOUND");
  if (matches.length > 1) throw new ExactTextEditError("The requested oldText appears more than once in the target note.", "DUPLICATE_OLD_TEXT", { count: matches.length });

  const start = matches[0]!;
  const end = start + oldText.length;
  if (start === 0 && end === content.length) throw new ExactTextEditError("replace_exact_text refuses full-note replacement.", "FULL_NOTE_REPLACEMENT");

  const contentAfter = `${content.slice(0, start)}${newText}${content.slice(end)}`;
  const before = contextAround(content, start, end);
  const after = contextAround(contentAfter, start, start + newText.length);
  const oldClip = clipEditPreview(oldText, CONTEXT_CHARS);
  const newClip = clipEditPreview(newText, CONTEXT_CHARS);
  return {
    contentAfter,
    targetKind: "exact_text",
    change: "replace",
    beforePreview: before.preview,
    afterPreview: after.preview,
    oldTextPreview: oldClip.preview,
    newTextPreview: newClip.preview,
    oldTextChars: oldText.length,
    newTextChars: newText.length,
    changedChars: newText.length - oldText.length,
    changedBytes: Buffer.byteLength(newText, "utf8") - Buffer.byteLength(oldText, "utf8"),
    previewTruncated: before.truncated || after.truncated || oldClip.truncated || newClip.truncated,
  };
}

function findMatches(content: string, oldText: string): number[] {
  const matches: number[] = [];
  let start = 0;
  while (start <= content.length) {
    const index = content.indexOf(oldText, start);
    if (index === -1) break;
    matches.push(index);
    start = index + 1;
  }
  return matches;
}

function contextAround(content: string, start: number, end: number): { preview: string; truncated: boolean } {
  if (content.length <= CONTEXT_CHARS) return { preview: content, truncated: false };
  const matchLength = Math.max(0, end - start);
  const remaining = Math.max(0, CONTEXT_CHARS - matchLength);
  const beforeChars = Math.floor(remaining / 2);
  const afterChars = remaining - beforeChars;
  const from = Math.max(0, start - beforeChars);
  const to = Math.min(content.length, end + afterChars);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < content.length ? "…" : "";
  return { preview: `${prefix}${content.slice(from, to)}${suffix}`, truncated: true };
}
