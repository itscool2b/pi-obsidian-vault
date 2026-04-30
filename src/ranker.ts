import type { EnrichedCandidateSeed } from "./metadata-enricher.js";
import type { EvidenceQuality, MatchReason, RankedCandidate, RankingSignal, ResolvedRetrievalMode } from "./retrieval-types.js";
import { buildPreview } from "./preview.js";
import { createQueryProfile, normalizeText, qualityRank, strongestQuality, textMatchProfile, type QueryProfile } from "./query-profile.js";

const SIGNAL_WEIGHTS: Record<RankingSignal, number> = {
  exact_file: 125,
  title: 110,
  alias: 100,
  tag: 82,
  property: 78,
  heading: 72,
  path: 68,
  content: 34,
  backlink: 36,
  outgoing_link: 32,
  recency: 14,
  project_folder: 12,
  fuzzy: 38,
};

const QUALITY_MULTIPLIER: Record<EvidenceQuality, number> = {
  strong: 1.25,
  supporting: 0.75,
  weak: 0.18,
  ignored: 0,
};

export function rankCandidates(candidates: EnrichedCandidateSeed[], query: string | undefined, options: { maxCandidates: number; previewChars: number; mode?: ResolvedRetrievalMode | undefined }): RankedCandidate[] {
  const profile = createQueryProfile(query);
  const ranked = candidates.map((candidate) => scoreCandidate(candidate, profile, query, options.previewChars));
  applyExplicitNavigationHubPreference(ranked, profile, options.mode ?? "search");
  applyNavigationSpecificRequestPreference(ranked, profile, options.mode ?? "search");
  ranked.sort((a, b) => qualityRank(b.evidenceQuality) - qualityRank(a.evidenceQuality) || b.score - a.score || a.path.localeCompare(b.path));
  return ranked.slice(0, options.maxCandidates).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function scoreCandidate(candidate: EnrichedCandidateSeed, profile: QueryProfile, query: string | undefined, previewChars: number): RankedCandidate {
  const reasons: MatchReason[] = [];
  let score = 0;
  let meaningfulScore = 0;
  let bestQuality: EvidenceQuality = "ignored";
  const availableSignals = new Set<RankingSignal>();
  const evidenceCounts = new Map<RankingSignal, number>();

  const addReason = (reason: MatchReason) => {
    if (reason.score <= 0 && reason.quality === "ignored") return;
    reasons.push(reason);
    score += reason.score;
    if ((reason.quality === "strong" || reason.quality === "supporting") && (!reason.isGenericOnly || reason.quality === "strong")) meaningfulScore += reason.score;
    if (reason.score > 0) availableSignals.add(reason.signal);
    bestQuality = strongestQuality(bestQuality, reason.quality);
  };

  for (const evidence of candidate.evidence) {
    const count = evidenceCounts.get(evidence.signal) ?? 0;
    evidenceCounts.set(evidence.signal, count + 1);
    if (evidence.signal === "content" && count >= 3) continue;
    const structured = isStructuredSignal(evidence.signal);
    const match = textMatchProfile(evidence.matched, profile, { structured, allowFuzzy: structured || evidence.signal === "content" });
    let quality: EvidenceQuality = evidence.signal === "exact_file" ? "strong" : match.quality;
    if (evidence.signal === "content" && evidence.field === "search") quality = quality === "ignored" ? "ignored" : "weak";
    if (evidence.signal === "project_folder" && quality === "ignored") quality = "weak";
    if (quality === "ignored" && evidence.signal !== "recency" && evidence.signal !== "project_folder") continue;
    const base = SIGNAL_WEIGHTS[evidence.signal] ?? 1;
    const bonus = evidence.weightHint ?? 0;
    const repeatPenalty = evidence.signal === "content" && quality !== "strong" ? Math.max(0.25, 1 - count * 0.3) : 1;
    const contextPenalty = evidence.signal === "content" && quality === "weak" ? 0.5 : 1;
    const phraseBonus = evidence.signal === "content" ? Math.max(0, ...match.matchedPhrases.map((phrase) => phrase.split(" ").length * 24)) : 0;
    const reasonScore = Math.round((base + bonus + phraseBonus) * QUALITY_MULTIPLIER[quality] * repeatPenalty * contextPenalty);
    addReason({
      signal: evidence.signal,
      field: evidence.field,
      evidence: evidence.matched,
      score: reasonScore,
      command: evidence.command,
      line: evidence.line,
      quality,
      matchedTerms: [...new Set([...match.matchedPhrases, ...match.matchedTerms, ...match.matchedGenericTerms])],
      isGenericOnly: match.isGenericOnly,
      isStopwordOnly: match.isStopwordOnly,
    });
  }

  if (profile.normalized) {
    addStructuredMatch("title", "title", candidate.title, profile);
    addStructuredMatch("path", "path", candidate.path, profile);

    for (const alias of candidate.metadata.aliases ?? []) addStructuredMatch("alias", "alias", alias, profile);
    for (const tag of candidate.metadata.tags ?? []) addStructuredMatch("tag", "tag", tag.replace(/^#/, ""), profile, tag);
    for (const [name, value] of Object.entries(candidate.metadata.properties ?? {})) addStructuredMatch("property", name, `${name} ${String(value)}`, profile, String(value));
    for (const heading of candidate.metadata.headings ?? []) addStructuredMatch("heading", "heading", heading.text, profile, heading.text, heading.line);
  }

  if (candidate.metadata.recent) {
    const recentScore = SIGNAL_WEIGHTS.recency;
    addReason({ signal: "recency", field: "recent", evidence: "recently opened", score: recentScore, quality: "weak" });
  }

  const topReasons = dedupeReasons(reasons)
    .sort((a, b) => b.score - a.score || qualityRank(b.quality) - qualityRank(a.quality) || a.signal.localeCompare(b.signal))
    .slice(0, 8);
  const bestQualityRank = qualityRank(bestQuality);
  const confidenceBase = bestQualityRank >= qualityRank("strong") ? 280 : bestQualityRank >= qualityRank("supporting") ? 360 : 700;
  const confidence = Math.max(0, Math.min(1, meaningfulScore > 0 ? score / confidenceBase : Math.min(0.25, score / 900)));
  const weakOnly = meaningfulScore <= 0 || bestQualityRank <= qualityRank("weak");
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
    evidenceQuality: bestQuality,
    meaningfulScore: Math.round(meaningfulScore),
    weakOnly,
  };

  function addStructuredMatch(signal: RankingSignal, field: string, value: string, queryProfile: QueryProfile, evidenceValue = value, line?: number | undefined): void {
    const match = textMatchProfile(value, queryProfile, { structured: true, allowFuzzy: signal === "title" || signal === "alias" });
    if (match.quality === "ignored") return;
    const resolvedSignal: RankingSignal = signal === "title" && match.fuzzy && match.quality !== "strong" ? "fuzzy" : signal;
    const base = SIGNAL_WEIGHTS[resolvedSignal] ?? 1;
    const genericPenalty = match.isGenericOnly && match.quality !== "strong" ? 0.45 : 1;
    const exactBonus = match.exact ? 70 : 0;
    const phraseBonus = Math.max(0, ...match.matchedPhrases.map((phrase) => phrase.split(" ").length * 16));
    const fuzzyLengthPenalty = resolvedSignal === "fuzzy" ? Math.max(0.45, Math.min(1, queryProfile.normalized.length / Math.max(normalizeText(value).length, 1))) : 1;
    const reasonScore = Math.round((base + Math.round(match.score * 24) + exactBonus + phraseBonus) * QUALITY_MULTIPLIER[match.quality] * genericPenalty * fuzzyLengthPenalty);
    addReason({
      signal: resolvedSignal,
      field,
      evidence: evidenceValue,
      score: reasonScore,
      line,
      quality: match.quality,
      matchedTerms: [...new Set([...match.matchedPhrases, ...match.matchedTerms, ...match.matchedGenericTerms])],
      isGenericOnly: match.isGenericOnly,
      isStopwordOnly: match.isStopwordOnly,
    });
  }
}

function applyExplicitNavigationHubPreference(candidates: RankedCandidate[], profile: QueryProfile, mode: ResolvedRetrievalMode): void {
  const requestedMarkers = requestedNavigationMarkers(profile, mode);
  if (requestedMarkers.length === 0) return;
  const coreProfile = navigationCoreProfile(profile);
  if (!coreProfile) return;

  const navigationMatches = candidates
    .map((candidate) => ({ candidate, match: navigationHubMatch(candidate, coreProfile, requestedMarkers) }))
    .filter((item): item is { candidate: RankedCandidate; match: NavigationHubMatch } => Boolean(item.match));
  if (navigationMatches.length === 0) return;

  const navigationSet = new Set(navigationMatches.map((item) => item.candidate.path));
  const bestNonNavigationScore = Math.max(0, ...candidates.filter((candidate) => !navigationSet.has(candidate.path)).map((candidate) => candidate.score));

  for (const { candidate, match } of navigationMatches) {
    const bonus = Math.round(900 + match.topicCoverage * 450 + Math.min(3, match.markerCount) * 90 + (mode === "graph" ? 350 : 0));
    candidate.score += bonus;
    candidate.meaningfulScore = Math.round((candidate.meaningfulScore ?? 0) + bonus);
    candidate.evidenceQuality = strongestQuality(candidate.evidenceQuality, "strong");
    candidate.confidence = Number(Math.max(candidate.confidence, mode === "graph" ? 0.9 : 0.82).toFixed(2));
    candidate.weakOnly = false;

    if (candidate.score <= bestNonNavigationScore) {
      const lift = bestNonNavigationScore - candidate.score + Math.round(80 + match.topicCoverage * 120 + (mode === "graph" ? 80 : 0));
      candidate.score += lift;
      candidate.meaningfulScore = Math.round((candidate.meaningfulScore ?? 0) + lift);
    }
  }
}

interface NavigationHubMatch {
  topicCoverage: number;
  markerCount: number;
}

function requestedNavigationMarkers(profile: QueryProfile, mode: ResolvedRetrievalMode): string[] {
  if (!profile.normalized) return [];
  const normalized = profile.normalized;
  const terms = new Set(profile.terms);
  const markers: string[] = [];
  if (terms.has("moc") || terms.has("mocs")) markers.push("moc");
  if (terms.has("index") || terms.has("indices")) markers.push("index");
  const asksForMap = terms.has("map") || terms.has("maps");
  const mapLooksNavigational = mode === "graph" || /\b(?:map|maps)\b.*\b(?:notes?|content|vault|index|moc|connections?|links?|backlinks?|related)\b/.test(normalized) || /\b(?:notes?|content|vault|index|moc|connections?|links?|backlinks?|related)\b.*\b(?:map|maps)\b/.test(normalized);
  if (asksForMap && mapLooksNavigational) markers.push("map");
  return [...new Set(markers)];
}

function navigationCoreProfile(profile: QueryProfile): QueryProfile | undefined {
  const terms = profile.meaningfulTerms.filter((term) => !NAVIGATION_INTENT_TERMS.has(term));
  if (terms.length === 0) return undefined;
  return createQueryProfile(terms.join(" "));
}

function navigationHubMatch(candidate: RankedCandidate, coreProfile: QueryProfile, requestedMarkers: string[]): NavigationHubMatch | undefined {
  const fields = navigationStructuredFields(candidate);
  const markerCount = fields.filter((value) => containsRequestedNavigationMarker(value, requestedMarkers)).length;
  if (markerCount === 0) return undefined;

  const structuredText = fields.join(" ");
  const topicMatch = textMatchProfile(structuredText, coreProfile, { structured: true, allowFuzzy: true });
  if (topicMatch.quality === "ignored" || topicMatch.isGenericOnly) return undefined;
  const requiredCoverage = coreProfile.meaningfulTerms.length <= 2 ? 1 : 0.66;
  if (topicMatch.coverage < requiredCoverage && topicMatch.matchedPhrases.length === 0 && !topicMatch.exact) return undefined;
  return { topicCoverage: topicMatch.coverage, markerCount };
}

function navigationStructuredFields(candidate: Pick<RankedCandidate, "title" | "metadata">): string[] {
  const fields = [candidate.title];
  fields.push(...(candidate.metadata.aliases ?? []));
  fields.push(...(candidate.metadata.tags ?? []).map((tag) => tag.replace(/^#/, "")));
  for (const [name, value] of Object.entries(candidate.metadata.properties ?? {})) fields.push(`${name} ${propertyValueText(value)}`);
  fields.push(...(candidate.metadata.headings ?? []).map((heading) => heading.text));
  return fields.filter((field) => field.trim().length > 0);
}

function containsRequestedNavigationMarker(value: string, requestedMarkers: string[]): boolean {
  const normalized = normalizeText(value);
  return requestedMarkers.some((marker) => {
    if (marker === "moc") return /\bmocs?\b/.test(normalized);
    if (marker === "index") return /\b(?:index|indices)\b/.test(normalized);
    if (marker === "map") return /\bmaps?\b/.test(normalized);
    return false;
  });
}

const NAVIGATION_INTENT_TERMS = new Set([
  "moc", "mocs", "index", "indices", "map", "maps", "graph", "graphs", "hub", "hubs", "router", "routers",
  "connection", "connections", "relationship", "relationships", "related", "link", "links", "backlink", "backlinks",
]);

function applyNavigationSpecificRequestPreference(candidates: RankedCandidate[], profile: QueryProfile, mode: ResolvedRetrievalMode): void {
  if (!shouldPreferSpecificContent(profile, mode)) return;
  const bestSpecificContentScore = Math.max(0, ...candidates
    .filter((candidate) => !isNavigationNote(candidate) && hasStrongSpecificContentEvidence(candidate, profile))
    .map((candidate) => candidate.score));
  if (bestSpecificContentScore <= 0) return;

  for (const candidate of candidates) {
    if (!isNavigationNote(candidate)) continue;
    const cappedScore = Math.max(1, bestSpecificContentScore - 1);
    const adjustedScore = Math.min(Math.round(candidate.score * 0.55), cappedScore);
    if (adjustedScore >= candidate.score) continue;
    const ratio = adjustedScore / Math.max(candidate.score, 1);
    candidate.score = adjustedScore;
    candidate.meaningfulScore = Math.round((candidate.meaningfulScore ?? 0) * ratio);
    candidate.confidence = Number(Math.max(0, Math.min(candidate.confidence, candidate.confidence * Math.max(0.45, ratio))).toFixed(2));
    candidate.weakOnly = candidate.weakOnly || (candidate.meaningfulScore ?? 0) <= 0;
  }
}

function shouldPreferSpecificContent(profile: QueryProfile, mode: ResolvedRetrievalMode): boolean {
  if (mode !== "search" && mode !== "context") return false;
  if (!profile.normalized || profile.isLowSignal) return false;
  return !isNavigationIntent(profile);
}

function isNavigationIntent(profile: QueryProfile): boolean {
  const terms = new Set(profile.terms);
  if (["moc", "mocs", "index", "indices", "graph", "hub", "router", "connection", "connections"].some((term) => terms.has(term))) return true;
  const normalized = profile.normalized;
  if ((terms.has("map") || terms.has("maps")) && /\b(?:map|maps)\b/.test(normalized) && /\b(?:of|around|for|notes?|content|vault|graph|connections?|index|moc)\b/.test(normalized)) return true;
  return normalized.includes("entry points") || normalized.includes("main spine") || normalized.includes("by note type");
}

function isNavigationNote(candidate: Pick<RankedCandidate, "title" | "metadata">): boolean {
  if (hasNavigationMarker(candidate.title)) return true;
  if ((candidate.metadata.aliases ?? []).some(hasNavigationMarker)) return true;
  if ((candidate.metadata.tags ?? []).some(hasNavigationMarker)) return true;
  const properties = candidate.metadata.properties ?? {};
  if (Object.entries(properties).some(([name, value]) => normalizeText(name) === "type" && normalizeText(propertyValueText(value)).split(" ").includes("meta"))) return true;
  return (candidate.metadata.headings ?? []).some((heading) => isNavigationHeading(heading.text));
}

function hasNavigationMarker(value: string): boolean {
  const normalized = normalizeText(value);
  return /\b(?:moc|mocs|index)\b/.test(normalized);
}

function isNavigationHeading(value: string): boolean {
  const normalized = normalizeText(value);
  return normalized === "entry points" || normalized === "main spine" || normalized === "by note type" || normalized.includes("entry points") || normalized.includes("main spine") || normalized.includes("by note type");
}

function propertyValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(" ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function hasStrongSpecificContentEvidence(candidate: RankedCandidate, profile: QueryProfile): boolean {
  return candidate.matchReasons.some((reason) => {
    if (reason.quality !== "strong" || reason.isGenericOnly) return false;
    if (reason.signal !== "title" && reason.signal !== "alias" && reason.signal !== "tag" && reason.signal !== "heading" && reason.signal !== "content") return false;
    const structured = isStructuredSignal(reason.signal);
    const match = textMatchProfile(reason.evidence, profile, { structured, allowFuzzy: false });
    if (match.quality !== "strong" || match.isGenericOnly) return false;
    if (profile.meaningfulTerms.length <= 1) return match.coverage >= 1 || match.exact || match.matchedPhrases.length > 0;
    const requiredCoverage = profile.meaningfulTerms.length <= 2 ? 1 : 0.75;
    return match.coverage >= requiredCoverage;
  });
}

function isStructuredSignal(signal: RankingSignal): boolean {
  return signal === "exact_file" || signal === "title" || signal === "alias" || signal === "tag" || signal === "property" || signal === "heading" || signal === "path";
}

function dedupeReasons(reasons: MatchReason[]): MatchReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.signal}:${reason.field}:${reason.evidence}:${reason.quality ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
