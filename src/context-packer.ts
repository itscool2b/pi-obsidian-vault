import { clip } from "./preview.js";
import type { BudgetConfig, BudgetProfile, CandidateMetadata, ContextPackage, ContextSection, ObsidianRetrieveOutput, RankedCandidate, RelationshipSummary, ResolvedRetrievalMode } from "./retrieval-types.js";

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
}): ObsidianRetrieveOutput {
  const candidates = input.candidates.slice(0, input.budget.candidateLimit).map((candidate) => compactCandidate(candidate, input.budget));
  return fitOutput({
    mode: input.mode,
    query: input.query,
    candidates,
    budget: { profile: input.profile, maxChars: input.budget.totalChars, usedChars: 0, truncated: false, omissions: [] },
    warnings: input.warnings ?? [],
    nextActions: input.nextActions ?? defaultNextActions(input.mode),
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
  return fitOutput({
    mode: "context",
    query: input.query,
    candidates: input.candidates.slice(0, input.budget.candidateLimit).map((candidate) => compactCandidate(candidate, input.budget)),
    context,
    budget: { profile: input.profile, maxChars: input.budget.totalChars, usedChars: 0, truncated: false, omissions: [] },
    warnings: input.warnings ?? [],
    nextActions: ["Use returned excerpts before asking for more context; request another candidate path only if needed."],
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
}): ObsidianRetrieveOutput {
  return fitOutput({
    mode: input.mode,
    query: input.query,
    candidates: input.candidates.slice(0, input.budget.candidateLimit).map((candidate) => compactCandidate(candidate, input.budget)),
    graph: compactGraph(input.graph, input.budget),
    budget: { profile: input.profile, maxChars: input.budget.totalChars, usedChars: 0, truncated: false, omissions: [] },
    warnings: input.warnings ?? [],
    nextActions: ["Select one returned candidate and request context for bounded excerpts."],
  }, input.budget.totalChars);
}

function fitOutput(output: ObsidianRetrieveOutput, maxChars: number): ObsidianRetrieveOutput {
  let next = output;
  let chars = measure(next);
  const omissions = [...next.budget.omissions];
  while (chars > maxChars && next.candidates.length > 1) {
    next = { ...next, candidates: next.candidates.slice(0, -1) };
    omissions.push("candidate omitted to fit response budget");
    chars = measure(next);
  }
  if (chars > maxChars && next.context && next.context.length > 0) {
    next = { ...next, context: next.context.slice(0, 1).map((pkg) => ({ ...pkg, sections: pkg.sections.slice(0, 1), omissions: [...pkg.omissions, "context clipped to fit response budget"] })) };
    omissions.push("context clipped to fit response budget");
    chars = measure(next);
  }
  const truncated = omissions.length > 0 || chars > maxChars;
  return { ...next, budget: { ...next.budget, usedChars: Math.min(chars, maxChars), truncated, omissions: [...new Set(omissions)] } };
}

function compactCandidate(candidate: RankedCandidate, budget: BudgetConfig): RankedCandidate {
  return {
    ...candidate,
    preview: clip(candidate.preview, budget.previewChars),
    matchReasons: candidate.matchReasons.slice(0, budget.metadataItems),
    metadata: compactMetadata(candidate.metadata, budget),
  };
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

function defaultNextActions(mode: ResolvedRetrievalMode): string[] {
  if (mode === "search") return ["Select a candidate path and call obsidian_retrieve with mode=context for bounded excerpts."];
  return ["Use candidate paths for follow-up context if needed."];
}

function measure(output: ObsidianRetrieveOutput): number {
  return JSON.stringify(output).length;
}
