import { normalizeVaultRelativePath } from "./path-safety.js";
import { clip } from "./preview.js";
import type { ContextSection, ObsidianCliBackend, RankedCandidate } from "./retrieval-types.js";

interface RawSection {
  heading?: string | undefined;
  startLine: number;
  endLine: number;
  text: string;
}

export async function selectSectionsForCandidates(
  backend: ObsidianCliBackend,
  candidates: RankedCandidate[],
  query: string | undefined,
  options: { sectionsPerNote: number; sectionChars: number; perNoteChars: number },
): Promise<Map<string, ContextSection[]>> {
  const result = new Map<string, ContextSection[]>();
  for (const candidate of candidates) {
    const safePath = normalizeVaultRelativePath(candidate.path, { allowEmpty: false, requireMarkdown: true });
    const note = await backend.read({ path: safePath });
    const sections = splitMarkdownSections(note.content);
    const scored = sections.map((section) => scoreSection(section, query, candidate));
    scored.sort((a, b) => b.relevance - a.relevance || a.startLine - b.startLine);
    const selected: ContextSection[] = [];
    let used = 0;
    for (const section of scored) {
      if (selected.length >= options.sectionsPerNote || used >= options.perNoteChars) break;
      const remaining = Math.max(0, Math.min(options.sectionChars, options.perNoteChars - used));
      if (remaining <= 0) break;
      const excerpt = clip(section.text, remaining);
      used += excerpt.length;
      const context: ContextSection = {
        startLine: section.startLine,
        endLine: section.endLine,
        relevance: section.relevance,
        reasons: section.reasons,
        excerpt,
        truncated: excerpt.length < section.text.replace(/\s+/g, " ").trim().length,
      };
      if (section.heading) context.heading = section.heading;
      selected.push(context);
    }
    result.set(candidate.path, selected);
  }
  return result;
}

export function splitMarkdownSections(content: string): RawSection[] {
  const lines = content.split(/\r?\n/);
  const sections: RawSection[] = [];
  let currentHeading: string | undefined;
  let startLine = 1;
  let buffer: string[] = [];

  const flush = (endLine: number) => {
    const text = buffer.join("\n").trim();
    if (text) {
      const section: RawSection = { startLine, endLine, text };
      if (currentHeading) section.heading = currentHeading;
      sections.push(section);
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flush(index);
      currentHeading = heading[2]?.trim();
      startLine = index + 1;
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }
  flush(lines.length);
  return sections.length > 0 ? sections : [{ startLine: 1, endLine: lines.length, text: content.trim() }];
}

function scoreSection(section: RawSection, query: string | undefined, candidate: RankedCandidate): ContextSection & { startLine: number; endLine: number; text: string } {
  const reasons: string[] = [];
  let relevance = 0;
  const text = `${section.heading ?? ""}\n${section.text}`.toLowerCase();
  const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  for (const term of terms) {
    if (text.includes(term)) {
      relevance += section.heading?.toLowerCase().includes(term) ? 30 : 12;
      reasons.push(`matched query term "${term}"`);
    }
  }
  for (const reason of candidate.matchReasons) {
    if (reason.line !== undefined && reason.line >= section.startLine && reason.line <= section.endLine) {
      relevance += Math.min(25, reason.score);
      reasons.push(`contains ${reason.signal} evidence`);
    }
  }
  if (section.heading) relevance += 4;
  if (relevance === 0) {
    relevance = Math.max(1, candidate.confidence * 10);
    reasons.push("highest ranked candidate fallback");
  }
  return {
    startLine: section.startLine,
    endLine: section.endLine,
    heading: section.heading,
    relevance: Math.round(relevance),
    reasons: [...new Set(reasons)],
    excerpt: "",
    truncated: false,
    text: section.text,
  };
}
