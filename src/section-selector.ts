import { normalizeVaultRelativePath } from "./path-safety.js";
import { clip } from "./preview.js";
import { createQueryProfile, normalizeText, textMatchProfile, tokenize, type QueryProfile } from "./query-profile.js";
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
  const profile = createQueryProfile(query);
  for (const candidate of candidates) {
    const safePath = normalizeVaultRelativePath(candidate.path, { allowEmpty: false, requireMarkdown: true });
    const note = await backend.read({ path: safePath });
    const sections = splitMarkdownSections(note.content);
    const scored = sections.map((section) => scoreSection(section, profile, candidate));
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

function scoreSection(section: RawSection, profile: QueryProfile, candidate: RankedCandidate): ContextSection & { startLine: number; endLine: number; text: string } {
  const reasons: string[] = [];
  let relevance = 0;
  const headingMatch = section.heading ? textMatchProfile(section.heading, profile, { structured: true, allowFuzzy: false }) : undefined;
  const bodyMatch = textMatchProfile(section.text, profile, { structured: false, allowFuzzy: false });
  const sectionIntent = createSectionIntentProfile(profile);
  const headingIntent = section.heading ? textMatchesSectionIntent(section.heading, sectionIntent) : emptySectionIntentMatch();
  const bodyIntent = textMatchesSectionIntent(section.text, sectionIntent);

  if (headingMatch && headingMatch.quality !== "ignored") {
    const points = headingMatch.isGenericOnly
      ? profile.isLowSignal ? 12 : 5
      : headingMatch.quality === "strong" ? 70 : headingMatch.quality === "supporting" ? 45 : 8;
    relevance += points;
    reasons.push(reasonText("heading", headingMatch));
  }
  if (bodyMatch.quality !== "ignored") {
    const points = bodyMatch.isGenericOnly
      ? profile.isLowSignal ? 4 : 0
      : bodyMatch.quality === "strong" ? 45 : bodyMatch.quality === "supporting" ? 26 : 4;
    relevance += points;
    if (bodyMatch.quality !== "weak" || bodyMatch.matchedTerms.length > 0 || bodyMatch.matchedPhrases.length > 0 || bodyMatch.isGenericOnly) reasons.push(reasonText("section", bodyMatch));
  }
  if (headingIntent.matched.length > 0) {
    relevance += Math.min(52, 34 + headingIntent.matched.length * 6);
    reasons.push(`heading matches section intent term${headingIntent.matched.length === 1 ? "" : "s"} "${headingIntent.matched.join(", ")}"`);
  }
  if (bodyIntent.matched.length > 0) {
    relevance += Math.min(30, 14 + bodyIntent.matched.length * 4);
    reasons.push(`section matches section intent term${bodyIntent.matched.length === 1 ? "" : "s"} "${bodyIntent.matched.join(", ")}"`);
  }

  for (const reason of candidate.matchReasons) {
    if (reason.line !== undefined && reason.line >= section.startLine && reason.line <= section.endLine) {
      const bonus = reason.isGenericOnly
        ? profile.isLowSignal ? Math.min(8, Math.max(2, reason.score)) : 0
        : Math.min(25, Math.max(reason.quality === "strong" ? 25 : reason.quality === "supporting" ? 16 : 4, reason.score));
      if (bonus > 0) {
        relevance += bonus;
        reasons.push(`contains ${reason.quality ?? "matching"} ${reason.signal} evidence`);
      }
    }
  }

  if (section.heading) relevance += 2;
  if (relevance === 0) {
    relevance = Math.max(1, Math.round(candidate.confidence * 6));
    reasons.push(profile.isLowSignal ? "weak fallback: query has no meaningful section terms" : "weak fallback: no meaningful query terms matched this section");
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

interface SectionIntentProfile {
  terms: string[];
}

interface SectionIntentMatch {
  matched: string[];
}

function createSectionIntentProfile(profile: QueryProfile): SectionIntentProfile {
  const queryTerms = new Set(profile.terms);
  const terms = new Set<string>();

  if (["progress", "progressed", "progression", "timeline", "phase", "phases", "milestone", "milestones", "roadmap", "history"].some((term) => queryTerms.has(term))) {
    for (const term of ["progress", "progressed", "progression", "timeline", "phase", "phases", "milestone", "milestones", "roadmap", "history"]) terms.add(term);
  }

  if (asksForTopicOverview(profile)) {
    for (const term of ["overview", "tldr", "tl dr", "summary", "background", "introduction", "intro", "purpose", "scope", "goal", "goals", "objective", "objectives", "topic"]) terms.add(term);
  }

  return { terms: [...terms] };
}

function asksForTopicOverview(profile: QueryProfile): boolean {
  const queryTerms = new Set(profile.terms);
  if (["overview", "summary", "summarize", "tldr", "topic", "about", "background", "purpose", "scope"].some((term) => queryTerms.has(term))) return true;
  return queryTerms.has("what") && (queryTerms.has("is") || queryTerms.has("are") || queryTerms.has("was") || queryTerms.has("were"));
}

function textMatchesSectionIntent(value: string, intent: SectionIntentProfile): SectionIntentMatch {
  if (intent.terms.length === 0) return emptySectionIntentMatch();
  const normalized = normalizeText(value);
  const valueTerms = new Set(tokenize(value));
  const matched = intent.terms.filter((term) => {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) return false;
    if (normalizedTerm.includes(" ")) return normalized.includes(normalizedTerm);
    return valueTerms.has(normalizedTerm) || normalized.includes(normalizedTerm);
  });
  return { matched: [...new Set(matched)] };
}

function emptySectionIntentMatch(): SectionIntentMatch {
  return { matched: [] };
}

function reasonText(scope: "heading" | "section", match: ReturnType<typeof textMatchProfile>): string {
  const evidence = match.matchedPhrases[0] ?? match.matchedTerms.join(", ") ?? match.matchedGenericTerms.join(", ");
  if (match.matchedPhrases.length > 0) return `${scope} matches phrase "${evidence}"`;
  if (match.matchedTerms.length > 0) return `${scope} matches meaningful term${match.matchedTerms.length === 1 ? "" : "s"} "${match.matchedTerms.join(", ")}"`;
  if (match.isGenericOnly) return `${scope} has weak generic-term overlap "${match.matchedGenericTerms.join(", ")}"`;
  return `${scope} has ${match.quality} query evidence`;
}
