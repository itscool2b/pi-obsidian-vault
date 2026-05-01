import { collectCandidateSeeds } from "./candidate-collector.js";
import { budgetForProfile, packCandidateResponse, packContextResponse, packGraphResponse } from "./context-packer.js";
import { RetrievalError } from "./errors.js";
import { enrichCandidateMetadata, metadataCoverage } from "./metadata-enricher.js";
import { normalizeVaultRelativePath } from "./path-safety.js";
import { rankCandidates } from "./ranker.js";
import { selectSectionsForCandidates } from "./section-selector.js";
import { normalizeText, qualityRank } from "./query-profile.js";
import type { CandidateSeed, DegradedSignal, ObsidianCliBackend, ObsidianRetrieveOutput, RankedCandidate, RelationshipSummary, RetrievalRequest, BudgetProfile, RelatedNoteRef, SeedEvidence } from "./retrieval-types.js";

export interface RetrievalEngineOptions {
  defaultBudget?: BudgetProfile | undefined;
  budgetChars?: Partial<Record<BudgetProfile, number>> | undefined;
}

export async function obsidianRetrieve(backend: ObsidianCliBackend, request: RetrievalRequest, options: RetrievalEngineOptions = {}): Promise<ObsidianRetrieveOutput> {
  const profile = request.budget ?? options.defaultBudget ?? "standard";
  const budget = budgetForProfile(profile, options.budgetChars);
  const maxCandidates = Math.max(1, Math.min(request.maxCandidates ?? budget.candidateLimit, budget.candidateLimit));
  const warnings = intentWarnings(request);
  const mode = resolveMode(request);
  const degradedSignals = new Set<DegradedSignal>();

  if ((mode === "search" || mode === "project" || mode === "graph") && !request.query?.trim() && !request.scope?.folder && !request.scope?.recent) {
    throw new RetrievalError("obsidian_retrieve requires a query, folder scope, selected candidate, or recent scope", "INVALID_RETRIEVE_REQUEST");
  }

  if (mode === "context") {
    const selected = request.selected ?? [];
    if (selected.length === 0) throw new RetrievalError("context mode requires selected candidate paths", "MISSING_SELECTED_CANDIDATE");
    const selectedSeeds: CandidateSeed[] = selected.slice(0, budget.selectedNoteLimit).map((candidate) => {
      const path = normalizeVaultRelativePath(candidate.path, { allowEmpty: false, requireMarkdown: true });
      const evidence: SeedEvidence = { signal: "exact_file", field: "selected", matched: candidate.title ?? path, command: "selected" };
      return { path, title: candidate.title, evidence: [evidence], searchLines: [], sourceCommands: ["selected"] };
    });
    const enriched = await enrichCandidateMetadata(backend, selectedSeeds, { metadataItems: budget.metadataItems, hydrateRelationships: true, degradedSignals });
    const ranked = rankCandidates(enriched, request.query, { maxCandidates, previewChars: budget.previewChars, mode });
    const selectedRanked = ranked.slice(0, budget.selectedNoteLimit);
    const sectionsByPath = await selectSectionsForCandidates(backend, selectedRanked, request.query, budget);
    const relationshipsByPath = new Map<string, RelationshipSummary>();
    for (const candidate of selectedRanked) {
      relationshipsByPath.set(candidate.path, await buildRelationshipSummary(backend, candidate, budget, degradedSignals));
    }
    applyDegradedWarnings(warnings, degradedSignals);
    return packContextResponse({ query: request.query, candidates: ranked, sectionsByPath, relationshipsByPath, budget, profile, warnings, degradedSignals: [...degradedSignals] });
  }

  const seeds = await collectCandidateSeeds(backend, request, { seedLimit: budget.seedLimit, degradedSignals });
  const enriched = await enrichCandidateMetadata(backend, seeds, { metadataItems: budget.metadataItems, hydrateRelationships: mode === "graph" || mode === "project", degradedSignals });
  const ranked = rankCandidates(enriched, request.query, { maxCandidates, previewChars: budget.previewChars, mode });
  if (ranked.length === 0) warnings.push("No candidates found from Obsidian CLI signals; try a title, alias, tag, property, or folder scope.");
  const coverage = metadataCoverage(enriched);
  if (coverage < 95) warnings.push(`Candidate metadata coverage is ${coverage}% for this response.`);

  if (mode === "graph" || mode === "project") {
    const center = reliableRelationshipTarget(ranked, request.query);
    if (!center && ranked.length > 0) warnings.push(`No reliable ${mode} target found from meaningful evidence; relationship summary was not centered on a weak candidate.`);
    const graph = center ? await buildRelationshipSummary(backend, center, budget, degradedSignals) : { depth: budget.graphDepth, omittedCount: 0 };
    applyDegradedWarnings(warnings, degradedSignals);
    return packGraphResponse({ mode, query: request.query, candidates: ranked, graph, budget, profile, warnings, degradedSignals: [...degradedSignals] });
  }

  applyDegradedWarnings(warnings, degradedSignals);
  return packCandidateResponse({ mode: "search", query: request.query, candidates: ranked, budget, profile, warnings, degradedSignals: [...degradedSignals] });
}

function resolveMode(request: RetrievalRequest): "search" | "context" | "graph" | "project" {
  if (request.mode === "context") return "context";
  if (request.mode === "graph") return "graph";
  if (request.mode === "project") return "project";
  if (request.mode === "search") return "search";
  if (request.selected && request.selected.length > 0) return "context";
  if (request.scope?.folder) return "project";
  return "search";
}

function intentWarnings(request: RetrievalRequest): string[] {
  const query = request.query?.toLowerCase() ?? "";
  const warnings: string[] = [];
  if (/\b(write|create|append|prepend|replace|edit|rename|delete|move|trash|restore|copy|duplicate|clone|open)\b/.test(query)) {
    warnings.push("obsidian_retrieve is read-only; write/edit/manage/open intents are not executed and only retrieval candidates are returned.");
  }
  return warnings;
}

async function buildRelationshipSummary(backend: ObsidianCliBackend, candidate: RankedCandidate, budget: { graphDepth: number; graphNeighbors: number }, degradedSignals?: Set<DegradedSignal>): Promise<RelationshipSummary> {
  const summary: RelationshipSummary = { centerPath: candidate.path, depth: budget.graphDepth, omittedCount: 0 };
  try {
    const links = await backend.links({ path: candidate.path });
    const outgoing = links.links.slice(0, budget.graphNeighbors).map((link): RelatedNoteRef => {
      const ref: RelatedNoteRef = { path: link.path ?? link.rawTarget ?? "", reason: "outgoing link" };
      if (link.title) ref.title = link.title;
      ref.score = 1;
      return ref;
    }).filter((link) => link.path !== "");
    if (outgoing.length > 0) summary.outgoing = outgoing;
    summary.omittedCount += Math.max(0, links.links.length - outgoing.length);
  } catch {
    degradedSignals?.add("relationships");
  }
  try {
    const backlinks = await backend.backlinks({ path: candidate.path });
    const incoming = backlinks.backlinks.slice(0, budget.graphNeighbors).map((backlink): RelatedNoteRef => {
      const ref: RelatedNoteRef = { path: backlink.path, reason: backlink.context ?? "backlink" };
      if (backlink.title) ref.title = backlink.title;
      ref.score = 1;
      return ref;
    });
    if (incoming.length > 0) summary.backlinks = incoming;
    summary.omittedCount += Math.max(0, backlinks.backlinks.length - incoming.length);
  } catch {
    degradedSignals?.add("backlinks");
    degradedSignals?.add("relationships");
  }
  return summary;
}

function reliableRelationshipTarget(candidates: RankedCandidate[], query: string | undefined): RankedCandidate | undefined {
  const [top, second] = candidates;
  if (!top || top.weakOnly || qualityRank(top.evidenceQuality) < qualityRank("supporting") || (top.meaningfulScore ?? 0) <= 0) return undefined;
  if (second && !second.weakOnly && qualityRank(second.evidenceQuality) >= qualityRank("supporting")) {
    const margin = (top.score - second.score) / Math.max(top.score, 1);
    if (margin <= 0.15 && !hasExactQueryCandidateDominance(top, second, query)) return undefined;
  }
  return top;
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

function applyDegradedWarnings(warnings: string[], degradedSignals: Set<DegradedSignal>): void {
  if (degradedSignals.size === 0) return;
  const list = [...degradedSignals].sort().join(", ");
  const warning = `Retrieval signals degraded (${list}); confidence may be lower.`;
  if (!warnings.includes(warning)) warnings.push(warning);
}
