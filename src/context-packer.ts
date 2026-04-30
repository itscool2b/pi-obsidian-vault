import { buildAgentGuidance, enrichCandidateForAgent, legacyNextActions } from "./agent-guidance.js";
import { clip } from "./preview.js";
import type { BudgetConfig, BudgetProfile, CandidateMetadata, ContextPackage, ContextSection, DegradedSignal, ObsidianRetrieveOutput, RankedCandidate, RelationshipSummary, ResolvedRetrievalMode } from "./retrieval-types.js";

export function budgetForProfile(profile: BudgetProfile | undefined, overrides?: Partial<Record<BudgetProfile, number>>): BudgetConfig {
  const resolved = profile ?? "standard";
  const totals: Record<BudgetProfile, number> = {
    tiny: overrides?.tiny ?? 3_500,
    standard: overrides?.standard ?? 8_000,
    expanded: overrides?.expanded ?? 12_000,
  };
  const totalChars = Math.min(12_000, totals[resolved]);
  return {
    candidateLimit: resolved === "tiny" ? 5 : resolved === "standard" ? 8 : 12,
    seedLimit: resolved === "tiny" ? 25 : 60,
    previewChars: resolved === "tiny" ? 160 : 240,
    metadataItems: resolved === "tiny" ? 4 : 8,
    selectedNoteLimit: resolved === "expanded" ? 3 : 2,
    sectionsPerNote: resolved === "expanded" ? 4 : 3,
    sectionChars: resolved === "tiny" ? 500 : 900,
    perNoteChars: resolved === "tiny" ? 1_000 : resolved === "standard" ? 2_400 : 3_500,
    graphDepth: resolved === "expanded" ? 2 : 1,
    graphNeighbors: resolved === "tiny" ? 4 : 8,
    totalChars,
  };
}

export function packCandidateResponse(input: {
  mode: ResolvedRetrievalMode;
  query?: string | undefined;
  candidates: RankedCandidate[];
  budget: BudgetConfig;
  profile: BudgetProfile;
  warnings?: string[] | undefined;
  nextActions?: string[] | undefined;
  degradedSignals?: DegradedSignal[] | undefined;
}): ObsidianRetrieveOutput {
  const candidates = input.candidates.slice(0, input.budget.candidateLimit).map((candidate) => compactCandidate(candidate, input.budget));
  const guidance = buildAgentGuidance({ mode: input.mode, query: input.query, candidates, warnings: input.warnings, degradedSignals: input.degradedSignals });
  return fitOutput({
    mode: input.mode,
    query: input.query,
    candidates,
    budget: { profile: input.profile, maxChars: input.budget.totalChars, usedChars: 0, truncated: false, omissions: [] },
    warnings: input.warnings ?? [],
    nextActions: input.nextActions ?? legacyNextActions(guidance),
    agentGuidance: guidance,
  }, input.budget.totalChars);
}

export function packContextResponse(input: {
  query?: string | undefined;
  candidates: RankedCandidate[];
  sectionsByPath: Map<string, ContextSection[]>;
  metadataByPath?: Map<string, CandidateMetadata> | undefined;
  relationshipsByPath?: Map<string, RelationshipSummary> | undefined;
  budget: BudgetConfig;
  profile: BudgetProfile;
  warnings?: string[] | undefined;
  degradedSignals?: DegradedSignal[] | undefined;
}): ObsidianRetrieveOutput {
  const context: ContextPackage[] = [];
  for (const candidate of input.candidates.slice(0, input.budget.selectedNoteLimit)) {
    const sections = (input.sectionsByPath.get(candidate.path) ?? []).slice(0, input.budget.sectionsPerNote);
    const packageMetadata = input.metadataByPath?.get(candidate.path) ?? candidate.metadata;
    const usedChars = sections.reduce((sum, section) => sum + section.excerpt.length, 0);
    const pkg: ContextPackage = {
      path: candidate.path,
      title: candidate.title,
      selectedReason: candidate.matchReasons[0]?.evidence ?? "selected candidate",
      sections,
      metadata: compactMetadata(packageMetadata, input.budget),
      omissions: [],
      usedChars,
    };
    const relationships = input.relationshipsByPath?.get(candidate.path);
    if (relationships) pkg.relationships = relationships;
    if (sections.some((section) => section.truncated)) pkg.omissions.push("one or more sections were clipped to budget");
    context.push(pkg);
  }
  const candidates = input.candidates.slice(0, input.budget.candidateLimit).map((candidate) => compactCandidate(candidate, input.budget));
  const guidance = buildAgentGuidance({ mode: "context", query: input.query, candidates, contextReturned: context.length > 0, warnings: input.warnings, degradedSignals: input.degradedSignals });
  return fitOutput({
    mode: "context",
    query: input.query,
    candidates,
    context,
    budget: { profile: input.profile, maxChars: input.budget.totalChars, usedChars: 0, truncated: false, omissions: [] },
    warnings: input.warnings ?? [],
    nextActions: legacyNextActions(guidance),
    agentGuidance: guidance,
  }, input.budget.totalChars);
}

export function packGraphResponse(input: {
  mode: "graph" | "project";
  query?: string | undefined;
  candidates: RankedCandidate[];
  graph: RelationshipSummary;
  budget: BudgetConfig;
  profile: BudgetProfile;
  warnings?: string[] | undefined;
  degradedSignals?: DegradedSignal[] | undefined;
}): ObsidianRetrieveOutput {
  const candidates = input.candidates.slice(0, input.budget.candidateLimit).map((candidate) => compactCandidate(candidate, input.budget));
  const guidance = buildAgentGuidance({ mode: input.mode, query: input.query, candidates, warnings: input.warnings, degradedSignals: input.degradedSignals });
  return fitOutput({
    mode: input.mode,
    query: input.query,
    candidates,
    graph: compactGraph(input.graph, input.budget),
    budget: { profile: input.profile, maxChars: input.budget.totalChars, usedChars: 0, truncated: false, omissions: [] },
    warnings: input.warnings ?? [],
    nextActions: legacyNextActions(guidance),
    agentGuidance: guidance,
  }, input.budget.totalChars);
}

function fitOutput(output: ObsidianRetrieveOutput, maxChars: number): ObsidianRetrieveOutput {
  let next = output;
  let chars = measure(next);
  const omissions = [...next.budget.omissions];
  if (chars > maxChars) {
    next = stripCandidateLowPriorityDetails(next);
    omissions.push("low-priority candidate details clipped to fit response budget");
    chars = measure(next);
  }
  while (chars > maxChars && next.candidates.length > 1) {
    next = alignGuidanceToCandidates({ ...next, candidates: next.candidates.slice(0, -1) });
    omissions.push("candidate omitted to fit response budget");
    chars = measure(next);
  }
  if (chars > maxChars && next.context && next.context.length > 0) {
    next = stripContextLowPriorityDetails(next);
    omissions.push("low-priority context metadata clipped to fit response budget");
    chars = measure(next);
  }
  if (chars > maxChars && next.context && next.context.length > 0) {
    next = { ...next, context: next.context.slice(0, 1).map((pkg) => {
      const sections = pkg.sections.slice(0, Math.max(1, Math.min(2, pkg.sections.length)));
      return { ...pkg, sections, usedChars: sections.reduce((sum, section) => sum + section.excerpt.length, 0), omissions: [...pkg.omissions, "context clipped to fit response budget"] };
    }) };
    omissions.push("context clipped to fit response budget");
    chars = measure(next);
  }
  if (chars > maxChars) {
    next = minimizeOutputForBudget(next);
    omissions.push("low-priority details clipped to fit response budget");
    chars = measure(next);
  }
  const truncated = omissions.length > 0 || chars > maxChars;
  return { ...next, budget: { ...next.budget, usedChars: Math.min(chars, maxChars), truncated, omissions: [...new Set(omissions)] } };
}

function stripCandidateLowPriorityDetails(output: ObsidianRetrieveOutput): ObsidianRetrieveOutput {
  const candidates = output.candidates.map((candidate, index) => ({
    ...candidate,
    preview: clip(candidate.preview, 80),
    matchReasons: candidate.matchReasons.slice(0, 2),
    matchSummary: candidate.matchSummary ? { headline: candidate.matchSummary.headline, signals: candidate.matchSummary.signals.slice(0, 2) } : candidate.matchSummary,
    metadata: index === 0 ? candidate.metadata : {},
  }));
  return alignGuidanceToCandidates({ ...output, candidates });
}

function stripContextLowPriorityDetails(output: ObsidianRetrieveOutput): ObsidianRetrieveOutput {
  const candidates = output.candidates.map((candidate) => ({
    ...candidate,
    preview: clip(candidate.preview, 80),
    matchReasons: candidate.matchReasons.slice(0, 2),
    matchSummary: candidate.matchSummary ? { headline: candidate.matchSummary.headline, signals: candidate.matchSummary.signals.slice(0, 2) } : candidate.matchSummary,
    metadata: {},
  }));
  const context = output.context?.map((pkg) => ({
    ...pkg,
    metadata: {},
    relationships: undefined,
    omissions: [...pkg.omissions, "metadata removed to preserve selected excerpts"],
  }));
  return alignGuidanceToCandidates({ ...output, candidates, context });
}

function minimizeOutputForBudget(output: ObsidianRetrieveOutput): ObsidianRetrieveOutput {
  const candidates = output.candidates.slice(0, 1).map((candidate) => ({
    ...candidate,
    preview: clip(candidate.preview, 80),
    matchReasons: candidate.matchReasons.slice(0, 1),
    matchSummary: candidate.matchSummary ? { headline: candidate.matchSummary.headline, signals: candidate.matchSummary.signals.slice(0, 1) } : candidate.matchSummary,
    metadata: {},
  }));
  const context = output.context?.slice(0, 1).map((pkg) => ({
    path: pkg.path,
    title: pkg.title,
    selectedReason: pkg.selectedReason,
    sections: pkg.sections.slice(0, 1).map((section) => ({ ...section, excerpt: clip(section.excerpt, 300), truncated: true })),
    metadata: {},
    omissions: [...pkg.omissions, "context minimized to fit response budget"],
    usedChars: Math.min(pkg.sections[0]?.excerpt.length ?? pkg.usedChars, 300),
  }));
  const minimized: ObsidianRetrieveOutput = { ...output, candidates };
  if (context) minimized.context = context;
  return alignGuidanceToCandidates(minimized);
}

function alignGuidanceToCandidates(output: ObsidianRetrieveOutput): ObsidianRetrieveOutput {
  const candidatePaths = new Set(output.candidates.map((candidate) => candidate.path));
  const agentGuidance = {
    ...output.agentGuidance,
    alternatives: output.agentGuidance.alternatives.filter((candidate) => candidatePaths.has(candidate.path)),
  };
  return { ...output, agentGuidance };
}

function compactCandidate(candidate: RankedCandidate, budget: BudgetConfig): RankedCandidate {
  return enrichCandidateForAgent({
    ...candidate,
    preview: clip(candidate.preview, budget.previewChars),
    matchReasons: candidate.matchReasons.slice(0, budget.metadataItems),
    metadata: compactMetadata(candidate.metadata, budget),
  }, { signalLimit: budget.metadataItems });
}

function compactMetadata(metadata: CandidateMetadata, budget: BudgetConfig): CandidateMetadata {
  const compact: CandidateMetadata = {};
  if (metadata.aliases && metadata.aliases.length > 0) compact.aliases = metadata.aliases.slice(0, budget.metadataItems);
  if (metadata.tags && metadata.tags.length > 0) compact.tags = metadata.tags.slice(0, budget.metadataItems);
  if (metadata.properties) compact.properties = Object.fromEntries(Object.entries(metadata.properties).slice(0, budget.metadataItems));
  if (metadata.links && metadata.links.length > 0) compact.links = metadata.links.slice(0, budget.metadataItems);
  if (metadata.backlinks && metadata.backlinks.length > 0) compact.backlinks = metadata.backlinks.slice(0, budget.metadataItems);
  if (metadata.headings && metadata.headings.length > 0) compact.headings = metadata.headings.slice(0, budget.metadataItems);
  if (metadata.recent) compact.recent = true;
  if (metadata.modified) compact.modified = metadata.modified;
  if (metadata.size !== undefined) compact.size = metadata.size;
  return compact;
}

function compactGraph(graph: RelationshipSummary, budget: BudgetConfig): RelationshipSummary {
  const compact: RelationshipSummary = { depth: Math.min(graph.depth, budget.graphDepth), omittedCount: graph.omittedCount };
  if (graph.centerPath) compact.centerPath = graph.centerPath;
  if (graph.outgoing) compact.outgoing = graph.outgoing.slice(0, budget.graphNeighbors);
  if (graph.backlinks) compact.backlinks = graph.backlinks.slice(0, budget.graphNeighbors);
  if (graph.sharedTags) compact.sharedTags = graph.sharedTags.slice(0, budget.graphNeighbors);
  if (graph.sharedProperties) compact.sharedProperties = graph.sharedProperties.slice(0, budget.graphNeighbors);
  if (graph.projectHubs) compact.projectHubs = graph.projectHubs.slice(0, budget.graphNeighbors);
  return compact;
}

function measure(output: ObsidianRetrieveOutput): number {
  return JSON.stringify(output).length;
}
