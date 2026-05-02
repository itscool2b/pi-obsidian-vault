import type { BudgetProfile, MarkdownLinkMetadata, WikiLinkMetadata } from "./retrieval-types.js";

export const RELATIONSHIP_MAX_RELATED = 50;

export type RelationshipStatus = "success" | "validation_error" | "safety_refusal" | "not_found" | "setup_required";
export type RelationshipDegradedSignal = "backlinks_unavailable" | "backlinks_limited" | "relationships_limited" | "sections_limited" | "budget" | "parsing";

export interface RelationshipRequestOptions {
  budget?: BudgetProfile | undefined;
  maxRelated?: number | undefined;
  includeBacklinks?: boolean | undefined;
  includeOutgoing?: boolean | undefined;
  includeSections?: boolean | undefined;
  explain?: boolean | undefined;
}

export interface RelationshipSummaryOverview {
  outgoingCount: number;
  inboundCount: number | null;
  relatedCount: number | null;
  backlinkDataUnavailable: boolean;
  relationshipDataTruncated: boolean;
  explicitNoteParsingOnly: boolean;
  outgoingIncluded: boolean;
  backlinksIncluded: boolean;
  sectionsIncluded: boolean;
}

export interface InboundReference {
  path: string;
  title?: string | undefined;
  matchedTarget?: string | undefined;
  line?: number | undefined;
  referenceType?: "wiki" | "markdown" | "backend" | undefined;
  snippet?: string | undefined;
}

export interface RelatedRelationshipNote {
  path: string;
  title?: string | undefined;
  relationshipTypes: Array<"outgoing_markdown" | "outgoing_wiki" | "inbound">;
  occurrenceCount: number;
}

export interface RelationshipLinkImpact {
  sourcePath: string;
  outgoingWikiLinkCount: number;
  outgoingMarkdownLinkCount: number;
  hasOutgoingLinks: boolean;
  inboundReferenceCount: number | null;
  backlinkDataUnavailable: boolean;
  linkRewriteSupported: false;
  linkImpactWarning?: string | undefined;
}

export interface SectionRelationshipSummary {
  heading?: string | undefined;
  headingLevel?: number | undefined;
  startLine: number;
  endLine: number;
  outgoingWikiLinkCount: number;
  outgoingMarkdownLinkCount: number;
  inboundReferenceCount: number | null;
  truncated: boolean;
}

export interface RelationshipNextAction {
  priority: number;
  action: "inspect_explicit_note" | "retry_with_safe_path" | "stop" | "request_explicit_validation";
  label: string;
  params?: { path?: string | undefined; mode?: "note" | "relationships" | undefined } | undefined;
}

export interface RelationshipError {
  code: string;
  category: "validation" | "safety" | "not_found" | "setup" | "runtime";
  message: string;
  recoverable: boolean;
}

export interface RelationshipRetrieveFields {
  tool: "obsidian_retrieve";
  status: RelationshipStatus;
  mode: "relationships";
  path?: string | undefined;
  relationshipSummary: RelationshipSummaryOverview;
  outgoingWikiLinks: WikiLinkMetadata[];
  outgoingMarkdownLinks: MarkdownLinkMetadata[];
  inboundReferences: InboundReference[];
  relatedNotes: RelatedRelationshipNote[];
  linkImpact?: RelationshipLinkImpact | undefined;
  sectionRelationshipSummaries?: SectionRelationshipSummary[] | undefined;
  warnings: string[];
  degradedSignals: RelationshipDegradedSignal[];
  nextActions: RelationshipNextAction[];
  error?: RelationshipError | undefined;
}
