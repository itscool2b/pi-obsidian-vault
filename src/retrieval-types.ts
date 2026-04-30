export type RetrievalMode = "auto" | "search" | "context" | "graph" | "project";
export type ResolvedRetrievalMode = "search" | "context" | "graph" | "project";
export type BudgetProfile = "tiny" | "standard" | "expanded";
export type RankingSignal = "title" | "path" | "alias" | "tag" | "property" | "heading" | "content" | "backlink" | "outgoing_link" | "recency" | "project_folder" | "exact_file" | "fuzzy";
export type ConfidenceLevel = "high" | "medium" | "low" | "none";
export type AgentResultState = "answer_from_discovery" | "request_context" | "ambiguous" | "no_match" | "context_returned";
export type AnswerScope = "discovery_only" | "needs_selected_context" | "clarify_first" | "use_returned_context";
export type ContextRecommendationMode = "none" | "context";
export type StructuredAction = "answer" | "request_context" | "clarify" | "refine_query" | "inspect_alternative" | "stop";
export type DegradedSignal = "metadata" | "backlinks" | "properties" | "recents" | "relationships";
export type EvidenceQuality = "strong" | "supporting" | "weak" | "ignored";

export interface SelectedCandidateRef {
  path: string;
  title?: string | undefined;
}

export interface RetrievalScope {
  folder?: string | undefined;
  tags?: string[] | undefined;
  properties?: Record<string, string | number | boolean> | undefined;
  recent?: boolean | undefined;
}

export interface RetrievalRequest {
  query?: string | undefined;
  mode?: RetrievalMode | undefined;
  selected?: SelectedCandidateRef[] | undefined;
  scope?: RetrievalScope | undefined;
  budget?: BudgetProfile | undefined;
  maxCandidates?: number | undefined;
  explain?: boolean | undefined;
}

export interface SearchCommandInput {
  query: string;
  folder?: string | undefined;
  limit: number;
  caseSensitive?: boolean | undefined;
}

export interface SearchHit {
  path: string;
  scoreHint?: number | undefined;
}

export interface SearchContextHit {
  path: string;
  line: number;
  text: string;
}

export interface SearchCommandResult {
  hits: SearchHit[];
  total?: number | undefined;
  limited: boolean;
}

export interface SearchContextCommandResult {
  hits: SearchContextHit[];
  total?: number | undefined;
  limited: boolean;
}

export interface FilesCommandInput {
  folder?: string | undefined;
  limit?: number | undefined;
}

export interface FileListItem {
  path: string;
  name?: string | undefined;
  modified?: string | undefined;
  size?: number | undefined;
}

export interface FileListCommandResult {
  files: FileListItem[];
  total?: number | undefined;
  limited: boolean;
}

export interface FoldersCommandInput {
  folder?: string | undefined;
  limit?: number | undefined;
}

export interface FolderListItem {
  path: string;
  name?: string | undefined;
  noteCount?: number | undefined;
}

export interface FolderListCommandResult {
  folders: FolderListItem[];
  total?: number | undefined;
  limited: boolean;
}

export interface PathCommandInput {
  path: string;
}

export interface OptionalPathCommandInput {
  path?: string | undefined;
}

export interface FileCommandInput {
  path?: string | undefined;
  file?: string | undefined;
}

export interface FileInfoCommandResult {
  path: string;
  name?: string | undefined;
  extension?: string | undefined;
  modified?: string | undefined;
  created?: string | undefined;
  size?: number | undefined;
}

export interface ReadCommandResult {
  path: string;
  content: string;
}

export interface OutlineHeading {
  text: string;
  level?: number | undefined;
  line?: number | undefined;
}

export interface OutlineCommandResult {
  path: string;
  headings: OutlineHeading[];
  limited: boolean;
}

export interface AliasItem {
  alias: string;
  paths: string[];
}

export interface AliasesCommandResult {
  aliases: AliasItem[];
  limited: boolean;
}

export interface TagItem {
  tag: string;
  count?: number | undefined;
  paths?: string[] | undefined;
}

export interface TagsCommandResult {
  tags: TagItem[];
  total?: number | undefined;
  limited: boolean;
}

export interface PropertyItem {
  name: string;
  value?: string | number | boolean | string[] | undefined;
  count?: number | undefined;
  paths?: string[] | undefined;
}

export interface PropertiesCommandResult {
  properties: PropertyItem[];
  total?: number | undefined;
  limited: boolean;
}

export interface LinkItem {
  path?: string | undefined;
  rawTarget?: string | undefined;
  title?: string | undefined;
  line?: number | undefined;
}

export interface LinksCommandResult {
  path: string;
  links: LinkItem[];
  total?: number | undefined;
  limited: boolean;
}

export interface BacklinkItem {
  path: string;
  title?: string | undefined;
  matchedTarget?: string | undefined;
  line?: number | undefined;
  context?: string | undefined;
}

export interface BacklinksCommandResult {
  path: string;
  backlinks: BacklinkItem[];
  total?: number | undefined;
  limited: boolean;
}

export interface RecentItem {
  path: string;
  title?: string | undefined;
  openedAt?: string | undefined;
}

export interface RecentsCommandResult {
  recents: RecentItem[];
  total?: number | undefined;
  limited: boolean;
}

export interface ObsidianCliHealth {
  available: boolean;
  version?: string | undefined;
  cliPath: string;
  vaultTarget?: string | undefined;
  errors: string[];
  warnings: string[];
}

export interface ObsidianCliHealthOptions {
  allowAutoLaunch?: boolean | undefined;
}

export interface ObsidianCliBackend {
  checkHealth(options?: ObsidianCliHealthOptions): Promise<ObsidianCliHealth>;
  search(input: SearchCommandInput): Promise<SearchCommandResult>;
  searchContext(input: SearchCommandInput): Promise<SearchContextCommandResult>;
  files(input: FilesCommandInput): Promise<FileListCommandResult>;
  folders(input: FoldersCommandInput): Promise<FolderListCommandResult>;
  file(input: FileCommandInput): Promise<FileInfoCommandResult>;
  read(input: PathCommandInput): Promise<ReadCommandResult>;
  outline(input: PathCommandInput): Promise<OutlineCommandResult>;
  aliases(input: OptionalPathCommandInput): Promise<AliasesCommandResult>;
  tags(input: OptionalPathCommandInput & { counts?: boolean | undefined; tag?: string | undefined }): Promise<TagsCommandResult>;
  properties(input: OptionalPathCommandInput & { name?: string | undefined; counts?: boolean | undefined }): Promise<PropertiesCommandResult>;
  links(input: PathCommandInput): Promise<LinksCommandResult>;
  backlinks(input: PathCommandInput): Promise<BacklinksCommandResult>;
  recents(): Promise<RecentsCommandResult>;
}

export interface SearchLine {
  path: string;
  line: number;
  text: string;
  query?: string | undefined;
  command: "search:context";
}

export interface SeedEvidence {
  signal: RankingSignal;
  field: string;
  matched: string;
  line?: number | undefined;
  weightHint?: number | undefined;
  command?: string | undefined;
}

export interface CandidateSeed {
  path: string;
  title?: string | undefined;
  evidence: SeedEvidence[];
  searchLines?: SearchLine[] | undefined;
  sourceCommands: string[];
}

export interface LinkSummary {
  path?: string | undefined;
  title?: string | undefined;
  rawTarget?: string | undefined;
  reason: string;
  line?: number | undefined;
}

export interface BacklinkSummary {
  path: string;
  title?: string | undefined;
  matchedTarget?: string | undefined;
  reason: string;
  line?: number | undefined;
  context?: string | undefined;
}

export interface HeadingSummary {
  text: string;
  level?: number | undefined;
  line?: number | undefined;
}

export interface CandidateMetadata {
  aliases?: string[] | undefined;
  tags?: string[] | undefined;
  properties?: Record<string, unknown> | undefined;
  links?: LinkSummary[] | undefined;
  backlinks?: BacklinkSummary[] | undefined;
  headings?: HeadingSummary[] | undefined;
  recent?: boolean | undefined;
  modified?: string | undefined;
  size?: number | undefined;
}

export interface MatchReason {
  signal: RankingSignal;
  field: string;
  evidence: string;
  score: number;
  command?: string | undefined;
  line?: number | undefined;
  quality?: EvidenceQuality | undefined;
  matchedTerms?: string[] | undefined;
  isGenericOnly?: boolean | undefined;
  isStopwordOnly?: boolean | undefined;
}

export interface SignalExplanation {
  signal: RankingSignal;
  evidence: string;
  why: string;
  line?: number | undefined;
}

export interface MatchSummary {
  headline: string;
  signals: SignalExplanation[];
}

export interface RankedCandidate {
  rank: number;
  score: number;
  confidence: number;
  path: string;
  title: string;
  preview: string;
  matchReasons: MatchReason[];
  metadata: CandidateMetadata;
  availableSignals: RankingSignal[];
  evidenceQuality?: EvidenceQuality | undefined;
  meaningfulScore?: number | undefined;
  weakOnly?: boolean | undefined;
  selectedRef?: SelectedCandidateRef | undefined;
  confidenceLevel?: ConfidenceLevel | undefined;
  matchSummary?: MatchSummary | undefined;
}

export interface ContextSection {
  heading?: string | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
  relevance: number;
  reasons: string[];
  excerpt: string;
  truncated: boolean;
}

export interface RelatedNoteRef {
  path: string;
  title?: string | undefined;
  reason: string;
  score?: number | undefined;
}

export interface TagRelationship {
  tag: string;
  paths: string[];
  count: number;
  reason: string;
}

export interface PropertyRelationship {
  property: string;
  value?: string | number | boolean | undefined;
  paths: string[];
  count: number;
  reason: string;
}

export interface RelationshipSummary {
  centerPath?: string | undefined;
  depth: number;
  outgoing?: RelatedNoteRef[] | undefined;
  backlinks?: RelatedNoteRef[] | undefined;
  sharedTags?: TagRelationship[] | undefined;
  sharedProperties?: PropertyRelationship[] | undefined;
  projectHubs?: RelatedNoteRef[] | undefined;
  omittedCount: number;
}

export interface ContextPackage {
  path: string;
  title: string;
  selectedReason: string;
  sections: ContextSection[];
  metadata: CandidateMetadata;
  relationships?: RelationshipSummary | undefined;
  omissions: string[];
  usedChars: number;
}

export interface BudgetReport {
  profile: BudgetProfile;
  maxChars: number;
  usedChars: number;
  truncated: boolean;
  omissions: string[];
}

export interface BestMatchSummary {
  selectedRef?: SelectedCandidateRef | undefined;
  rank: number;
  path: string;
  title: string;
  reason: string;
  preview?: string | undefined;
  topSignals: RankingSignal[];
}

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  score?: number | undefined;
  ambiguous: boolean;
  marginToNext?: number | undefined;
  rationale: string;
  degradedSignals?: DegradedSignal[] | undefined;
}

export interface ContextRecommendation {
  recommended: boolean;
  reason: string;
  selected: SelectedCandidateRef[];
  mode: ContextRecommendationMode;
  query?: string | undefined;
  answerScope: AnswerScope;
}

export interface StructuredNextAction {
  priority: number;
  action: StructuredAction;
  label: string;
  params?: {
    mode?: "context" | undefined;
    selected?: SelectedCandidateRef[] | undefined;
    query?: string | undefined;
  } | undefined;
}

export interface AgentGuidance {
  resultState: AgentResultState;
  bestMatch: BestMatchSummary | null;
  confidence: ConfidenceAssessment;
  contextRecommendation: ContextRecommendation;
  alternatives: SelectedCandidateRef[];
  nextActions: StructuredNextAction[];
}

export interface ObsidianRetrieveOutput {
  mode: ResolvedRetrievalMode;
  query?: string | undefined;
  candidates: RankedCandidate[];
  context?: ContextPackage[] | undefined;
  graph?: RelationshipSummary | undefined;
  budget: BudgetReport;
  warnings: string[];
  nextActions: string[];
  agentGuidance: AgentGuidance;
}

export interface BudgetConfig {
  candidateLimit: number;
  seedLimit: number;
  previewChars: number;
  metadataItems: number;
  selectedNoteLimit: number;
  sectionsPerNote: number;
  sectionChars: number;
  perNoteChars: number;
  graphDepth: number;
  graphNeighbors: number;
  totalChars: number;
}

export interface RetrieveMetrics {
  cliCalls: number;
  candidateMetadataCoveragePct: number;
  baselineFirstResponseChars?: number | undefined;
  firstResponseReductionPct?: number | undefined;
  failureReasonCategory?: "ranking" | "missing_metadata" | "ambiguous_query" | "budget_limit" | "unavailable_vault_signal" | "none" | undefined;
}
