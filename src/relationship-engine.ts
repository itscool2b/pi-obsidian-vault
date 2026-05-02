import { budgetForProfile } from "./context-packer.js";
import { PathSafetyError } from "./errors.js";
import { parseMarkdownNote, sortWarnings } from "./note-parser.js";
import { isSafeMarkdownPath, normalizeExplicitMarkdownNotePath } from "./path-safety.js";
import { clip } from "./preview.js";
import type { AgentGuidance, BudgetProfile, MarkdownLinkMetadata, ObsidianCliBackend, ObsidianRetrieveOutput, RetrievalRequest, WikiLinkMetadata } from "./retrieval-types.js";
import { RELATIONSHIP_MAX_RELATED, type InboundReference, type RelatedRelationshipNote, type RelationshipDegradedSignal, type RelationshipError, type RelationshipLinkImpact, type RelationshipNextAction, type RelationshipRetrieveFields, type RelationshipSummaryOverview, type SectionRelationshipSummary } from "./relationship-types.js";

type RelationshipRequest = RetrievalRequest & {
  maxRelated?: number | undefined;
  includeBacklinks?: boolean | undefined;
  includeOutgoing?: boolean | undefined;
  includeSections?: boolean | undefined;
};

const DEGRADED_ORDER: RelationshipDegradedSignal[] = ["backlinks_unavailable", "backlinks_limited", "relationships_limited", "sections_limited", "budget", "parsing"];

export async function retrieveRelationships(backend: ObsidianCliBackend, request: RelationshipRequest, options: { defaultBudget?: BudgetProfile | undefined; budgetChars?: Partial<Record<BudgetProfile, number>> | undefined } = {}): Promise<ObsidianRetrieveOutput> {
  const profile = request.budget ?? options.defaultBudget ?? "standard";
  const budget = budgetForProfile(profile, options.budgetChars);
  const maxRelated = normalizeMaxRelated(request.maxRelated, budget.graphNeighbors);
  if (!maxRelated.ok) return relationshipOutput({ profile, maxChars: budget.totalChars, status: "validation_error", warnings: [maxRelated.warning], error: relationshipError("INVALID_MAX_RELATED", "validation", maxRelated.message) });

  const broadField = broadRelationshipField(request);
  if (broadField) {
    return relationshipOutput({ profile, maxChars: budget.totalChars, status: "validation_error", warnings: [`Relationship mode accepts only one explicit path; unsupported field ${broadField} was refused.`], error: relationshipError("UNSUPPORTED_RELATIONSHIP_FIELD", "validation", "Provide mode=relationships with path, budget, maxRelated, includeBacklinks, includeOutgoing, includeSections, and explain only.") });
  }

  const includeOutgoing = request.includeOutgoing !== false;
  const includeBacklinks = request.includeBacklinks !== false;
  const includeSections = request.includeSections === true;

  const safePath = normalizeRelationshipPath((request as { path?: unknown }).path);
  if (!safePath.ok) {
    return relationshipOutput({ profile, maxChars: budget.totalChars, status: safePath.status, warnings: [safePath.warning], error: safePath.error });
  }

  let content: string;
  try {
    content = (await backend.read({ path: safePath.path })).content;
  } catch {
    return relationshipOutput({ profile, maxChars: budget.totalChars, status: "not_found", path: safePath.path, relationshipSummary: emptySummary({ outgoingIncluded: false, backlinksIncluded: false, sectionsIncluded: false, explicitOnly: false }), linkImpact: emptyLinkImpact(safePath.path), warnings: ["The requested note was not found; no content was read or inferred."], nextActions: [{ priority: 1, action: "retry_with_safe_path", label: "Retry only after the user provides an existing safe vault-relative Markdown path.", params: { mode: "relationships" } }], error: relationshipError("NOTE_NOT_FOUND", "not_found", "The requested Markdown note does not exist or is not readable.") });
  }

  const parsed = parseMarkdownNote(content);
  const degradedSignals = new Set<RelationshipDegradedSignal>();
  for (const signal of parsed.degradedSignals) {
    if (signal === "parsing" || signal === "budget") degradedSignals.add(signal);
  }

  const limit = Math.min(maxRelated.value, budget.graphNeighbors, RELATIONSHIP_MAX_RELATED);
  let relationshipDataTruncated = false;
  let outgoingWikiLinks: WikiLinkMetadata[] = [];
  let outgoingMarkdownLinks: MarkdownLinkMetadata[] = [];
  if (includeOutgoing) {
    outgoingWikiLinks = parsed.outgoingWikiLinks.slice(0, limit);
    outgoingMarkdownLinks = parsed.outgoingMarkdownLinks.slice(0, limit);
    relationshipDataTruncated ||= parsed.outgoingWikiLinks.length > outgoingWikiLinks.length || parsed.outgoingMarkdownLinks.length > outgoingMarkdownLinks.length;
  }

  let inboundReferences: InboundReference[] = [];
  let backlinkDataUnavailable = includeBacklinks;
  if (includeBacklinks) {
    try {
      const backlinks = await backend.backlinks({ path: safePath.path });
      const safeBacklinks = backlinks.backlinks.filter((item) => isSafeMarkdownPath(item.path));
      inboundReferences = safeBacklinks.slice(0, limit).map((item): InboundReference => {
        const ref: InboundReference = { path: normalizeExplicitMarkdownNotePath(item.path), referenceType: "backend" };
        if (item.title) ref.title = clip(item.title, 80);
        if (item.matchedTarget) ref.matchedTarget = clip(item.matchedTarget, 120);
        if (typeof item.line === "number") ref.line = item.line;
        if (item.context) ref.snippet = clip(item.context, 120);
        return ref;
      });
      backlinkDataUnavailable = false;
      relationshipDataTruncated ||= safeBacklinks.length > inboundReferences.length || backlinks.limited === true;
      if (backlinks.limited) degradedSignals.add("backlinks_limited");
    } catch {
      backlinkDataUnavailable = true;
      degradedSignals.add("backlinks_unavailable");
    }
  }

  const relatedNotes = buildRelatedNotes(outgoingWikiLinks, outgoingMarkdownLinks, inboundReferences).slice(0, limit);
  relationshipDataTruncated ||= buildRelatedNotes(outgoingWikiLinks, outgoingMarkdownLinks, inboundReferences).length > relatedNotes.length;
  if (relationshipDataTruncated) {
    degradedSignals.add("relationships_limited");
    degradedSignals.add("budget");
  }

  const sectionRelationshipSummaries = includeSections ? buildSectionSummaries(parsed.sections, limit) : undefined;
  if (sectionRelationshipSummaries && parsed.sections.length > sectionRelationshipSummaries.length) degradedSignals.add("sections_limited");

  const warnings = sortWarnings([
    ...parsed.warnings,
    ...(backlinkDataUnavailable && includeBacklinks ? ["Backlink data was not available from bounded metadata; no broad scan was performed."] : []),
    ...(relationshipDataTruncated ? ["Relationship data was clipped to fit the selected budget and maxRelated limit."] : []),
    ...(includeSections && sectionRelationshipSummaries?.some((section) => section.truncated) ? ["Section relationship summaries were clipped and do not contain full section content."] : []),
  ]);

  const summary: RelationshipSummaryOverview = {
    outgoingCount: includeOutgoing ? parsed.outgoingWikiLinks.length + parsed.outgoingMarkdownLinks.length : 0,
    inboundCount: includeBacklinks && !backlinkDataUnavailable ? inboundReferences.length : null,
    relatedCount: relatedNotes.length,
    backlinkDataUnavailable,
    relationshipDataTruncated,
    explicitNoteParsingOnly: !includeBacklinks || backlinkDataUnavailable,
    outgoingIncluded: includeOutgoing,
    backlinksIncluded: includeBacklinks && !backlinkDataUnavailable,
    sectionsIncluded: includeSections,
  };

  const linkImpact = buildLinkImpact(safePath.path, parsed.outgoingWikiLinks.length, parsed.outgoingMarkdownLinks.length, includeBacklinks && !backlinkDataUnavailable ? inboundReferences.length : null, backlinkDataUnavailable);
  return relationshipOutput({
    profile,
    maxChars: budget.totalChars,
    status: "success",
    path: safePath.path,
    relationshipSummary: summary,
    outgoingWikiLinks,
    outgoingMarkdownLinks,
    inboundReferences,
    relatedNotes,
    linkImpact,
    sectionRelationshipSummaries,
    warnings,
    degradedSignals: sortRelationshipDegradedSignals([...degradedSignals]),
    nextActions: [{ priority: 1, action: "inspect_explicit_note", label: "Inspect an explicit related note only if the user provides or confirms its safe vault-relative path.", params: { mode: "note" } }],
  });
}

function normalizeRelationshipPath(value: unknown): { ok: true; path: string } | { ok: false; status: "validation_error" | "safety_refusal"; warning: string; error: RelationshipError } {
  if (typeof value !== "string") return { ok: false, status: "validation_error", warning: "Missing relationship path; no note was read.", error: relationshipError("MISSING_PATH", "validation", "Provide one explicit safe vault-relative Markdown path.") };
  if (!value.trim()) return { ok: false, status: "validation_error", warning: "Empty relationship path refused; no note was read.", error: relationshipError("MISSING_PATH", "validation", "Provide one explicit safe vault-relative Markdown path.") };
  try {
    return { ok: true, path: normalizeExplicitMarkdownNotePath(value) };
  } catch (error) {
    if (error instanceof PathSafetyError && (error.code === "NON_MARKDOWN" || error.code === "EMPTY_PATH")) {
      return { ok: false, status: "validation_error", warning: "Invalid relationship path refused; no note was read.", error: relationshipError(error.code === "NON_MARKDOWN" ? "NOTE_NOT_MARKDOWN" : "MISSING_PATH", "validation", "Provide one explicit safe vault-relative Markdown .md path.") };
    }
    return { ok: false, status: "safety_refusal", warning: "Unsafe relationship path refused; no note was read.", error: relationshipError("UNSAFE_PATH", "safety", "Provide one explicit safe vault-relative Markdown path without absolute, traversal, hidden, .obsidian, wildcard, recursive, or bulk/list syntax.") };
  }
}

function broadRelationshipField(request: RelationshipRequest): string | undefined {
  if (request.selected !== undefined) return "selected";
  if (request.scope !== undefined) return "scope";
  if (request.maxCandidates !== undefined) return "maxCandidates";
  if (Array.isArray((request as { path?: unknown }).path)) return "path";
  return undefined;
}

function normalizeMaxRelated(value: unknown, budgetDefault: number): { ok: true; value: number } | { ok: false; warning: string; message: string } {
  if (value === undefined) return { ok: true, value: Math.min(budgetDefault, RELATIONSHIP_MAX_RELATED) };
  if (!Number.isInteger(value) || (value as number) < 1) return { ok: false, warning: "Invalid maxRelated refused; no note was read.", message: "Provide maxRelated as a positive bounded integer." };
  return { ok: true, value: Math.min(value as number, RELATIONSHIP_MAX_RELATED) };
}

function buildRelatedNotes(wikiLinks: WikiLinkMetadata[], markdownLinks: MarkdownLinkMetadata[], inboundReferences: InboundReference[]): RelatedRelationshipNote[] {
  const notes = new Map<string, RelatedRelationshipNote>();
  for (const link of markdownLinks) {
    if (link.isExternal || !isSafeMarkdownPath(link.target)) continue;
    const path = normalizeExplicitMarkdownNotePath(link.target);
    upsertRelated(notes, path, "outgoing_markdown");
  }
  for (const link of wikiLinks) {
    if (!link.target.endsWith(".md") || !isSafeMarkdownPath(link.target)) continue;
    const path = normalizeExplicitMarkdownNotePath(link.target);
    upsertRelated(notes, path, "outgoing_wiki");
  }
  for (const ref of inboundReferences) upsertRelated(notes, ref.path, "inbound", ref.title);
  const priority: Record<string, number> = { outgoing_markdown: 0, outgoing_wiki: 1, inbound: 2 };
  return [...notes.values()].sort((a, b) => {
    const type = Math.min(...a.relationshipTypes.map((item) => priority[item] ?? 99)) - Math.min(...b.relationshipTypes.map((item) => priority[item] ?? 99));
    if (type !== 0) return type;
    const path = a.path.localeCompare(b.path);
    if (path !== 0) return path;
    return b.occurrenceCount - a.occurrenceCount;
  });
}

function upsertRelated(notes: Map<string, RelatedRelationshipNote>, path: string, type: RelatedRelationshipNote["relationshipTypes"][number], title?: string): void {
  const existing = notes.get(path) ?? { path, relationshipTypes: [], occurrenceCount: 0 };
  if (title && !existing.title) existing.title = clip(title, 80);
  if (!existing.relationshipTypes.includes(type)) existing.relationshipTypes.push(type);
  existing.occurrenceCount += 1;
  notes.set(path, existing);
}

function buildSectionSummaries(sections: Array<{ heading?: string | undefined; headingLevel?: number | undefined; startLine: number; endLine: number; text: string }>, limit: number): SectionRelationshipSummary[] {
  return sections.slice(0, Math.min(limit, 6)).map((section) => {
    const parsed = parseMarkdownNote(section.text);
    const summary: SectionRelationshipSummary = {
      startLine: section.startLine,
      endLine: section.endLine,
      outgoingWikiLinkCount: parsed.outgoingWikiLinks.length,
      outgoingMarkdownLinkCount: parsed.outgoingMarkdownLinks.length,
      inboundReferenceCount: null,
      truncated: section.text.length > 500,
    };
    if (section.heading) summary.heading = clip(section.heading, 80);
    if (section.headingLevel !== undefined) summary.headingLevel = section.headingLevel;
    return summary;
  });
}

function buildLinkImpact(sourcePath: string, wikiCount: number, markdownCount: number, inboundCount: number | null, backlinkDataUnavailable: boolean): RelationshipLinkImpact {
  const warning = backlinkDataUnavailable
    ? "This relationship summary does not rewrite links. Outgoing links were detected, and inbound links may be unavailable without safe backlink metadata."
    : "This relationship summary does not rewrite links; it only reports bounded relationship metadata.";
  return { sourcePath, outgoingWikiLinkCount: wikiCount, outgoingMarkdownLinkCount: markdownCount, hasOutgoingLinks: wikiCount + markdownCount > 0, inboundReferenceCount: inboundCount, backlinkDataUnavailable, linkRewriteSupported: false, linkImpactWarning: warning };
}

function emptySummary(input: { outgoingIncluded: boolean; backlinksIncluded: boolean; sectionsIncluded: boolean; explicitOnly: boolean }): RelationshipSummaryOverview {
  return { outgoingCount: 0, inboundCount: null, relatedCount: null, backlinkDataUnavailable: !input.backlinksIncluded, relationshipDataTruncated: false, explicitNoteParsingOnly: input.explicitOnly, outgoingIncluded: input.outgoingIncluded, backlinksIncluded: input.backlinksIncluded, sectionsIncluded: input.sectionsIncluded };
}

function emptyLinkImpact(sourcePath: string): RelationshipLinkImpact {
  return { sourcePath, outgoingWikiLinkCount: 0, outgoingMarkdownLinkCount: 0, hasOutgoingLinks: false, inboundReferenceCount: null, backlinkDataUnavailable: true, linkRewriteSupported: false };
}

function relationshipError(code: string, category: RelationshipError["category"], message: string): RelationshipError {
  return { code, category, message, recoverable: true };
}

function sortRelationshipDegradedSignals(values: RelationshipDegradedSignal[]): RelationshipDegradedSignal[] {
  const set = new Set(values);
  return DEGRADED_ORDER.filter((signal) => set.has(signal));
}

function relationshipOutput(input: Partial<RelationshipRetrieveFields> & { profile: BudgetProfile; maxChars: number }): ObsidianRetrieveOutput {
  const relationshipFields: RelationshipRetrieveFields = {
    tool: "obsidian_retrieve",
    status: input.status ?? "success",
    mode: "relationships",
    ...(input.path ? { path: input.path } : {}),
    relationshipSummary: input.relationshipSummary ?? emptySummary({ outgoingIncluded: false, backlinksIncluded: false, sectionsIncluded: false, explicitOnly: false }),
    outgoingWikiLinks: input.outgoingWikiLinks ?? [],
    outgoingMarkdownLinks: input.outgoingMarkdownLinks ?? [],
    inboundReferences: input.inboundReferences ?? [],
    relatedNotes: input.relatedNotes ?? [],
    ...(input.linkImpact ? { linkImpact: input.linkImpact } : {}),
    ...(input.sectionRelationshipSummaries ? { sectionRelationshipSummaries: input.sectionRelationshipSummaries } : {}),
    warnings: sortWarnings(input.warnings ?? []),
    degradedSignals: input.degradedSignals ?? [],
    nextActions: input.nextActions ?? [{ priority: 1, action: input.status === "safety_refusal" ? "stop" : "retry_with_safe_path", label: input.status === "safety_refusal" ? "Do not retry until the request uses one explicit safe vault-relative Markdown path." : "Retry only after the user provides an existing safe vault-relative Markdown path." }],
    ...(input.error ? { error: input.error } : {}),
  };
  const guidance = relationshipGuidance(relationshipFields);
  const output = {
    ...relationshipFields,
    candidates: [],
    budget: { profile: input.profile, maxChars: input.maxChars, usedChars: 0, truncated: false, omissions: [] },
    agentGuidance: guidance,
  } as unknown as ObsidianRetrieveOutput;
  const usedChars = JSON.stringify(output).length;
  return { ...output, budget: { ...output.budget, usedChars: Math.min(usedChars, input.maxChars), truncated: usedChars > input.maxChars, omissions: usedChars > input.maxChars ? ["relationship output clipped by budget"] : [] } };
}

function relationshipGuidance(fields: RelationshipRetrieveFields): AgentGuidance {
  return {
    resultState: fields.status === "success" ? "answer_from_discovery" : fields.status === "not_found" ? "no_match" : "ambiguous",
    bestMatch: fields.path && fields.status === "success" ? { rank: 1, path: fields.path, title: fields.path.split("/").at(-1) ?? fields.path, reason: "explicit relationship path", topSignals: ["exact_file"] } : null,
    confidence: { level: fields.status === "success" ? "high" : "none", ambiguous: false, rationale: fields.status === "success" ? "Relationship data was built from one explicit safe path." : "Relationship request did not produce a successful relationship summary." },
    contextRecommendation: { recommended: false, reason: "Relationship mode does not infer additional context; inspect explicit safe paths only.", selected: [], mode: "none", answerScope: fields.status === "success" ? "discovery_only" : "clarify_first" },
    alternatives: [],
    nextActions: fields.nextActions.map((action) => ({ priority: action.priority, action: action.action === "inspect_explicit_note" ? "retry_with_path" : action.action === "stop" ? "stop" : "clarify", label: action.label, params: action.params?.path ? { path: action.params.path, mode: "note" } : undefined })),
  };
}
