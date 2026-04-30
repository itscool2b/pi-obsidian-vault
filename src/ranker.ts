import type { EnrichedCandidateSeed } from "./metadata-enricher.js";
import type { MatchReason, RankedCandidate, RankingSignal } from "./retrieval-types.js";
import { buildPreview } from "./preview.js";

const SIGNAL_WEIGHTS: Record<RankingSignal, number> = {
  exact_file: 120,
  title: 100,
  alias: 92,
  tag: 75,
  property: 70,
  heading: 65,
  content: 45,
  backlink: 40,
  outgoing_link: 35,
  recency: 20,
  project_folder: 18,
  path: 55,
  fuzzy: 40,
};

export function rankCandidates(candidates: EnrichedCandidateSeed[], query: string | undefined, options: { maxCandidates: number; previewChars: number }): RankedCandidate[] {
  const ranked = candidates.map((candidate) => scoreCandidate(candidate, query, options.previewChars));
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return ranked.slice(0, options.maxCandidates).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function scoreCandidate(candidate: EnrichedCandidateSeed, query: string | undefined, previewChars: number): RankedCandidate {
  const reasons: MatchReason[] = [];
  let score = 0;
  const availableSignals = new Set<RankingSignal>();
  const q = query?.trim() ?? "";
  const evidenceCounts = new Map<RankingSignal, number>();
  for (const evidence of candidate.evidence) {
    const count = evidenceCounts.get(evidence.signal) ?? 0;
    evidenceCounts.set(evidence.signal, count + 1);
    if (evidence.signal === "content" && count >= 3) continue;
    const base = SIGNAL_WEIGHTS[evidence.signal] ?? 1;
    const bonus = evidence.weightHint ?? 0;
    const repeatPenalty = evidence.signal === "content" ? Math.max(0.35, 1 - count * 0.25) : 1;
    const reasonScore = Math.round((base + bonus) * repeatPenalty);
    score += reasonScore;
    availableSignals.add(evidence.signal);
    reasons.push({ signal: evidence.signal, field: evidence.field, evidence: evidence.matched, score: reasonScore, command: evidence.command, line: evidence.line });
  }

  if (q) {
    const titleMatch = matchQuality(candidate.title, q);
    if (titleMatch > 0) {
      const signal = titleMatch >= 0.95 ? "title" : "fuzzy";
      const reasonScore = (titleMatch >= 0.95 ? SIGNAL_WEIGHTS.title : SIGNAL_WEIGHTS.fuzzy) + Math.round(titleMatch * 20);
      score += reasonScore;
      availableSignals.add(signal);
      reasons.push({ signal, field: "title", evidence: candidate.title, score: reasonScore });
    }

    const pathMatch = matchQuality(candidate.path, q);
    if (pathMatch > 0.2) {
      const reasonScore = SIGNAL_WEIGHTS.path + Math.round(pathMatch * 10);
      score += reasonScore;
      availableSignals.add("path");
      reasons.push({ signal: "path", field: "path", evidence: candidate.path, score: reasonScore });
    }

    for (const alias of candidate.metadata.aliases ?? []) {
      const quality = matchQuality(alias, q);
      if (quality > 0) {
        const reasonScore = SIGNAL_WEIGHTS.alias + Math.round(quality * 20);
        score += reasonScore;
        availableSignals.add("alias");
        reasons.push({ signal: "alias", field: "alias", evidence: alias, score: reasonScore });
      }
    }

    for (const tag of candidate.metadata.tags ?? []) {
      if (matchQuality(tag.replace(/^#/, ""), q.replace(/^#/, "")) > 0) {
        score += SIGNAL_WEIGHTS.tag;
        availableSignals.add("tag");
        reasons.push({ signal: "tag", field: "tag", evidence: tag, score: SIGNAL_WEIGHTS.tag });
      }
    }

    for (const [name, value] of Object.entries(candidate.metadata.properties ?? {})) {
      const text = `${name} ${String(value)}`;
      if (matchQuality(text, q) > 0) {
        score += SIGNAL_WEIGHTS.property;
        availableSignals.add("property");
        reasons.push({ signal: "property", field: name, evidence: String(value), score: SIGNAL_WEIGHTS.property });
      }
    }

    for (const heading of candidate.metadata.headings ?? []) {
      const quality = matchQuality(heading.text, q);
      if (quality > 0) {
        const reasonScore = SIGNAL_WEIGHTS.heading + Math.round(quality * 15);
        score += reasonScore;
        availableSignals.add("heading");
        reasons.push({ signal: "heading", field: "heading", evidence: heading.text, score: reasonScore, line: heading.line });
      }
    }
  }

  if (candidate.metadata.recent) {
    score += SIGNAL_WEIGHTS.recency;
    availableSignals.add("recency");
    reasons.push({ signal: "recency", field: "recent", evidence: "recently opened", score: SIGNAL_WEIGHTS.recency });
  }

  const topReasons = dedupeReasons(reasons).sort((a, b) => b.score - a.score).slice(0, 8);
  const confidence = Math.max(0, Math.min(1, score / 250));
  return {
    rank: 0,
    score: Math.round(score),
    confidence: Number(confidence.toFixed(2)),
    path: candidate.path,
    title: candidate.title,
    preview: buildPreview(candidate, query, previewChars),
    matchReasons: topReasons,
    metadata: candidate.metadata,
    availableSignals: [...availableSignals],
  };
}

function dedupeReasons(reasons: MatchReason[]): MatchReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.signal}:${reason.field}:${reason.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchQuality(value: string, query: string): number {
  const normalizedValue = normalize(value);
  const normalizedQuery = normalize(query);
  if (!normalizedValue || !normalizedQuery) return 0;
  if (normalizedValue === normalizedQuery) return 1;
  if (normalizedValue.includes(normalizedQuery)) return 0.9;
  const terms = normalizedQuery.split(" ").filter(Boolean);
  if (terms.length > 1 && terms.every((term) => normalizedValue.includes(term))) return 0.8;
  const compactValue = normalizedValue.replace(/\s+/g, "");
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  if (compactValue.includes(compactQuery)) return 0.75;
  for (const word of normalizedValue.split(/\s+/).filter(Boolean)) {
    const wordDistance = levenshtein(word, compactQuery);
    if (wordDistance <= Math.max(1, Math.floor(compactQuery.length * 0.35))) return Math.max(0.45, 1 - wordDistance / Math.max(word.length, compactQuery.length));
  }
  const distance = levenshtein(compactValue, compactQuery);
  const maxLength = Math.max(compactValue.length, compactQuery.length);
  if (distance <= Math.max(1, Math.floor(maxLength * 0.25))) return Math.max(0.35, 1 - distance / maxLength);
  return 0;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const costs = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    let previous = i;
    costs[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const current = costs[j + 1] ?? 0;
      const next = Math.min(current + 1, (costs[j] ?? 0) + 1, previous + (a[i] === b[j] ? 0 : 1));
      costs[j + 1] = next;
      previous = current;
    }
  }
  return costs[b.length] ?? Math.max(a.length, b.length);
}
