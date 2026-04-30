import { normalizeVaultRelativePath } from "./path-safety.js";
import { clip } from "./preview.js";
import { normalizeText, qualityRank } from "./query-profile.js";
import type {
  AgentGuidance,
  AgentResultState,
  AnswerScope,
  ConfidenceAssessment,
  ConfidenceLevel,
  ContextRecommendation,
  DegradedSignal,
  MatchReason,
  MatchSummary,
  RankedCandidate,
  RankingSignal,
  ResolvedRetrievalMode,
  SelectedCandidateRef,
  SignalExplanation,
  StructuredAction,
  StructuredNextAction,
} from "./retrieval-types.js";

const AMBIGUITY_MARGIN_THRESHOLD = 0.15;
const ACTION_ORDER: Record<StructuredAction, number> = {
  answer: 1,
  request_context: 2,
  clarify: 3,
  refine_query: 4,
  inspect_alternative: 5,
  stop: 6,
};
const STRONG_SIGNALS = new Set<RankingSignal>(["exact_file", "title", "alias", "tag", "property", "heading", "path"]);

export interface BuildAgentGuidanceInput {
  mode: ResolvedRetrievalMode;
  query?: string | undefined;
  candidates: RankedCandidate[];
  contextReturned?: boolean | undefined;
  warnings?: string[] | undefined;
  degradedSignals?: DegradedSignal[] | undefined;
}

export function enrichCandidateForAgent(candidate: RankedCandidate, options: { signalLimit?: number | undefined } = {}): RankedCandidate {
  const selectedRef = selectedRefForCandidate(candidate);
  const enriched: RankedCandidate = {
    ...candidate,
    confidenceLevel: confidenceLevelForScore(candidate.confidence),
    matchSummary: matchSummaryForCandidate(candidate, options.signalLimit ?? 3),
  };
  if (selectedRef) enriched.selectedRef = selectedRef;
  return enriched;
}

export function buildAgentGuidance(input: BuildAgentGuidanceInput): AgentGuidance {
  const candidates = [...input.candidates].sort((a, b) => a.rank - b.rank || b.score - a.score || a.path.localeCompare(b.path));
  const top = candidates[0];
  const degradedSignals = normalizeDegradedSignals(input.degradedSignals, input.warnings);
  const dumpStyle = isDumpStyleRequest(input.query);
  const confidence = confidenceAssessment(candidates, degradedSignals, input.query);

  if (!top) return noMatchGuidance(input.query, confidence);
  if (!input.contextReturned && confidence.level === "none") return noMatchGuidance(input.query, confidence);

  const bestMatch = bestMatchSummary(top);
  const alternatives = candidateAlternatives(candidates, confidence.ambiguous);
  let resultState: AgentResultState;
  let recommendation: ContextRecommendation;
  let actions: StructuredNextAction[];

  if (input.contextReturned) {
    resultState = "context_returned";
    recommendation = contextRecommendation({ state: resultState, query: input.query, selected: selectableRefs(candidates, 3) });
    actions = [{ priority: 1, action: "answer", label: "Use the returned selected-note excerpts before asking for more context." }];
  } else if (dumpStyle) {
    resultState = "ambiguous";
    recommendation = contextRecommendation({ state: resultState, query: input.query, selected: [], dumpStyle: true });
    actions = [
      { priority: 1, action: "clarify", label: "Ask the user to narrow the vault, folder, or note scope before loading context." },
      { priority: 2, action: "refine_query", label: "Retry with a focused title, alias, tag, property, or specific selected path." },
    ];
  } else if (confidence.ambiguous || confidence.level === "low") {
    resultState = "ambiguous";
    recommendation = contextRecommendation({ state: resultState, query: input.query, selected: [] });
    actions = [
      { priority: 1, action: "clarify", label: "Ask the user which candidate they mean before making content-specific claims." },
      { priority: 2, action: "inspect_alternative", label: "Inspect the listed alternatives if the user points to a different candidate." },
    ];
  } else if (isDiscoveryOnlyQuery(input.query)) {
    resultState = "answer_from_discovery";
    recommendation = contextRecommendation({ state: resultState, query: input.query, selected: selectableRefs(candidates, 1) });
    actions = [
      { priority: 1, action: "answer", label: "Answer from discovery metadata; request context only if the user asks what the note says." },
    ];
  } else {
    resultState = "request_context";
    recommendation = contextRecommendation({ state: resultState, query: input.query, selected: selectableRefs(candidates, 1) });
    actions = [
      requestContextAction(recommendation.selected, input.query),
    ];
  }

  return {
    resultState,
    bestMatch,
    confidence,
    contextRecommendation: recommendation,
    alternatives,
    nextActions: sortActions(actions),
  };
}

export function legacyNextActions(guidance: AgentGuidance): string[] {
  return guidance.nextActions.map((action) => action.label);
}

export function selectedRefForCandidate(candidate: Pick<RankedCandidate, "path" | "title">): SelectedCandidateRef | undefined {
  try {
    const safePath = normalizeVaultRelativePath(candidate.path, { allowEmpty: false, requireMarkdown: true });
    const ref: SelectedCandidateRef = { path: safePath };
    if (candidate.title) ref.title = candidate.title;
    return ref;
  } catch {
    return undefined;
  }
}

export function confidenceLevelForScore(score: number): ConfidenceLevel {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  if (score > 0) return "low";
  return "none";
}

export function ambiguityMargin(topScore: number, nextScore: number): number {
  return Number(((topScore - nextScore) / Math.max(topScore, 1)).toFixed(3));
}

export function isDumpStyleRequest(query: string | undefined): boolean {
  const text = query?.toLowerCase() ?? "";
  if (!text) return false;
  return /\b(dump|entire|full|whole|all|everything|every)\b/.test(text)
    && /\b(vault|folder|project|projects|notes?|bodies|body|context)\b/.test(text);
}

function noMatchGuidance(query: string | undefined, confidence: ConfidenceAssessment): AgentGuidance {
  const recommendation = contextRecommendation({ state: "no_match", query, selected: [] });
  return {
    resultState: "no_match",
    bestMatch: null,
    confidence,
    contextRecommendation: recommendation,
    alternatives: [],
    nextActions: sortActions([
      { priority: 1, action: "refine_query", label: "Retry with a more specific title, alias, tag, property, or folder scope." },
      { priority: 2, action: "clarify", label: "Ask the user for more detail before requesting note context." },
    ]),
  };
}

function bestMatchSummary(candidate: RankedCandidate): NonNullable<AgentGuidance["bestMatch"]> {
  const summary = candidate.matchSummary ?? matchSummaryForCandidate(candidate, 3);
  const selectedRef = candidate.selectedRef ?? selectedRefForCandidate(candidate);
  const best = {
    rank: candidate.rank,
    path: candidate.path,
    title: candidate.title,
    reason: summary.headline,
    topSignals: summary.signals.map((signal) => signal.signal),
  } satisfies Omit<NonNullable<AgentGuidance["bestMatch"]>, "selectedRef" | "preview">;
  const withOptional: NonNullable<AgentGuidance["bestMatch"]> = { ...best };
  if (selectedRef) withOptional.selectedRef = selectedRef;
  if (candidate.preview) withOptional.preview = candidate.preview;
  return withOptional;
}

function confidenceAssessment(candidates: RankedCandidate[], degradedSignals: DegradedSignal[], query: string | undefined): ConfidenceAssessment {
  const top = candidates[0];
  if (!top) {
    const none: ConfidenceAssessment = {
      level: "none",
      ambiguous: false,
      rationale: "No candidate matched the available vault signals.",
    };
    if (degradedSignals.length > 0) none.degradedSignals = degradedSignals;
    return none;
  }

  const second = candidates[1];
  const margin = second ? ambiguityMargin(top.score, second.score) : undefined;
  const topQuality = inferredQualityRank(top);
  const secondQuality = second ? inferredQualityRank(second) : 0;
  const meaningfulTop = !top.weakOnly && topQuality >= qualityRank("supporting") && ((top.meaningfulScore ?? 0) > 0 || top.evidenceQuality === undefined);
  const exactDominance = Boolean(second && hasExactQueryCandidateDominance(top, second, query));
  const ambiguous = Boolean(second && margin !== undefined && margin <= AMBIGUITY_MARGIN_THRESHOLD && !exactDominance && meaningfulTop && secondQuality >= qualityRank("supporting") && ((second.meaningfulScore ?? 0) > 0 || second.evidenceQuality === undefined));
  let level = meaningfulTop ? confidenceLevelForScore(top.confidence) : "none";
  if (ambiguous && level === "high") level = "medium";
  if (degradedSignals.length > 0 && level === "high") level = "medium";

  const rationaleParts: string[] = [];
  if (!meaningfulTop) {
    rationaleParts.push("No candidate has enough meaningful evidence; matches are weak, generic, or stopword-derived.");
  } else if (ambiguous && second) {
    rationaleParts.push(`Competing strong candidates are close (relative margin ${margin}): ${top.title} and ${second.title}.`);
  } else if (top.matchReasons.some((reason) => STRONG_SIGNALS.has(reason.signal) && reason.quality === "strong")) {
    rationaleParts.push("The top candidate has strong title, alias, tag, property, heading, path, or phrase evidence.");
  } else {
    rationaleParts.push("The top candidate is ranked highest from supporting meaningful vault signals.");
  }
  if (degradedSignals.length > 0) rationaleParts.push(`Some signals were unavailable (${degradedSignals.join(", ")}), so confidence was downgraded when needed.`);

  const assessment: ConfidenceAssessment = {
    level,
    score: top.confidence,
    ambiguous,
    rationale: rationaleParts.join(" "),
  };
  if (margin !== undefined) assessment.marginToNext = margin;
  if (degradedSignals.length > 0) assessment.degradedSignals = degradedSignals;
  return assessment;
}

function hasExactQueryCandidateDominance(top: RankedCandidate, second: RankedCandidate, query: string | undefined): boolean {
  const normalizedQuery = normalizeText(query ?? "");
  if (!normalizedQuery) return false;
  const topHasExactFile = top.matchReasons.some((reason) => reason.signal === "exact_file" && reason.quality === "strong");
  const secondHasExactFile = second.matchReasons.some((reason) => reason.signal === "exact_file" && reason.quality === "strong");
  if (topHasExactFile && !secondHasExactFile) return true;
  if (normalizeText(top.path) === normalizedQuery && normalizeText(second.path) !== normalizedQuery) return true;
  return normalizeText(top.title) === normalizedQuery && normalizeText(second.title) !== normalizedQuery;
}

function inferredQualityRank(candidate: RankedCandidate): number {
  if (candidate.evidenceQuality) return qualityRank(candidate.evidenceQuality);
  if (candidate.matchReasons.some((reason) => reason.quality === "strong" || STRONG_SIGNALS.has(reason.signal))) return qualityRank("strong");
  if (candidate.confidence > 0) return qualityRank("supporting");
  return qualityRank("ignored");
}

function candidateAlternatives(candidates: RankedCandidate[], include: boolean): SelectedCandidateRef[] {
  if (!include) return [];
  return candidates.slice(1)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .map((candidate) => candidate.selectedRef ?? selectedRefForCandidate(candidate))
    .filter((ref): ref is SelectedCandidateRef => Boolean(ref))
    .slice(0, 4);
}

function selectableRefs(candidates: RankedCandidate[], limit: number): SelectedCandidateRef[] {
  return candidates
    .map((candidate) => candidate.selectedRef ?? selectedRefForCandidate(candidate))
    .filter((ref): ref is SelectedCandidateRef => Boolean(ref))
    .slice(0, limit);
}

function contextRecommendation(input: { state: AgentResultState; query?: string | undefined; selected: SelectedCandidateRef[]; dumpStyle?: boolean | undefined }): ContextRecommendation {
  if (input.state === "no_match") {
    return { recommended: false, reason: "No candidate is available; refine the query or ask the user for more detail before requesting context.", selected: [], mode: "none", answerScope: "clarify_first" };
  }
  if (input.state === "context_returned") {
    return { recommended: false, reason: "Selected-note excerpts are already returned; use them before asking for more context.", selected: input.selected, mode: "none", answerScope: "use_returned_context" };
  }
  if (input.dumpStyle) {
    return { recommended: false, reason: "Broad dump-style requests must be narrowed before loading selected-note context.", selected: [], mode: "none", answerScope: "clarify_first" };
  }
  if (input.state === "ambiguous") {
    return { recommended: false, reason: "The result is ambiguous or low-confidence; clarify the intended candidate before loading context.", selected: [], mode: "none", answerScope: "clarify_first" };
  }
  if (input.state === "answer_from_discovery") {
    return { recommended: false, reason: "Discovery metadata is enough for note identification; request context only for content-specific claims.", selected: input.selected, mode: "none", answerScope: "discovery_only" };
  }

  const recommendation: ContextRecommendation = {
    recommended: input.selected.length > 0,
    reason: input.selected.length > 0 ? "Selected-note excerpts are recommended before making content-specific claims." : "No safe selected path is available for context; refine or clarify first.",
    selected: input.selected,
    mode: input.selected.length > 0 ? "context" : "none",
    answerScope: input.selected.length > 0 ? "needs_selected_context" : "clarify_first",
  };
  if (input.query) recommendation.query = input.query;
  return recommendation;
}

function requestContextAction(selected: SelectedCandidateRef[], query: string | undefined): StructuredNextAction {
  const params: NonNullable<StructuredNextAction["params"]> = { mode: "context", selected };
  if (query) params.query = query;
  return {
    priority: 1,
    action: "request_context",
    label: "Call obsidian_retrieve with mode=context for the selected best match before answering content questions.",
    params,
  };
}

function sortActions(actions: StructuredNextAction[]): StructuredNextAction[] {
  return [...actions].sort((a, b) => a.priority - b.priority || ACTION_ORDER[a.action] - ACTION_ORDER[b.action] || a.label.localeCompare(b.label));
}

function matchSummaryForCandidate(candidate: RankedCandidate, signalLimit: number): MatchSummary {
  const signals = candidate.matchReasons.slice(0, signalLimit).map(signalExplanation);
  const headline = signals[0]
    ? `${signalLabel(signals[0].signal)} match: ${clip(signals[0].evidence, 80)}.`
    : `Ranked match for ${candidate.title}.`;
  return { headline, signals };
}

function signalExplanation(reason: MatchReason): SignalExplanation {
  const explanation: SignalExplanation = {
    signal: reason.signal,
    evidence: clip(reason.evidence, 120),
    why: whyForSignal(reason.signal, reason),
  };
  if (reason.line !== undefined) explanation.line = reason.line;
  return explanation;
}

function whyForSignal(signal: RankingSignal, reason?: MatchReason): string {
  if (reason?.quality === "weak") return reason.isGenericOnly ? "This is weak supporting evidence because it only matches generic terms." : "This is weak supporting evidence and is not enough by itself.";
  switch (signal) {
    case "exact_file": return "The requested path directly identifies this note.";
    case "title": return "The note title closely matches the query.";
    case "alias": return "A note alias matches the query.";
    case "tag": return "A note tag matches the requested topic.";
    case "property": return "A note property matches the requested metadata.";
    case "heading": return "A heading in the note matches the query.";
    case "path": return "The vault-relative path matches the query.";
    case "content": return "A bounded search snippet matched the query.";
    case "recency": return "The note was recently opened.";
    case "project_folder": return "The note is inside the requested folder scope.";
    case "backlink": return "A backlink relationship supports this match.";
    case "outgoing_link": return "An outgoing link relationship supports this match.";
    case "fuzzy": return "A fuzzy text match supports this candidate.";
  }
}

function signalLabel(signal: RankingSignal): string {
  return signal.replace(/_/g, " ");
}

function normalizeDegradedSignals(explicit: DegradedSignal[] | undefined, warnings: string[] | undefined): DegradedSignal[] {
  const set = new Set<DegradedSignal>(explicit ?? []);
  for (const warning of warnings ?? []) {
    const lower = warning.toLowerCase();
    if (lower.includes("metadata")) set.add("metadata");
    if (lower.includes("backlink")) set.add("backlinks");
    if (lower.includes("propert")) set.add("properties");
    if (lower.includes("recent")) set.add("recents");
    if (lower.includes("relationship") || lower.includes("link")) set.add("relationships");
  }
  return [...set].sort();
}

function isDiscoveryOnlyQuery(query: string | undefined): boolean {
  const text = query?.toLowerCase() ?? "";
  return /\b(where|find|locate|which note|what note|path|title)\b/.test(text);
}
