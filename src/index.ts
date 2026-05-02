import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import path from "node:path";
import { Type } from "typebox";
import { defaultCommitTokenService } from "./commit-token.js";
import type { CommitTokenService } from "./commit-token-types.js";
import { editStatusFromConfig, loadConfig, manageStatusFromConfig, statusConfigSummary, statusFromConfig, writeStatusFromConfig, type EditVaultStatus, type LoadConfigOptions, type ManageVaultStatus, type VaultConfig, type VaultStatus, type WriteVaultStatus } from "./config.js";
import { budgetForProfile } from "./context-packer.js";
import { ObsidianCliAdapter } from "./obsidian-cli.js";
import { obsidianRetrieve } from "./retrieval-engine.js";
import { obsidianValidate, setupRequiredValidationResponse } from "./validation-engine.js";
import { obsidianEdit } from "./edit-engine.js";
import { obsidianManage } from "./manage-engine.js";
import { obsidianPlan } from "./plan-engine.js";
import { obsidianWrite } from "./write-engine.js";
import type { AgentGuidance, BudgetProfile, ObsidianCliBackend, ObsidianCliHealth, ObsidianRetrieveOutput, ResolvedRetrievalMode, RetrievalRequest } from "./retrieval-types.js";
import type { ObsidianEditRequest } from "./edit-types.js";
import type { ObsidianManageRequest } from "./manage-types.js";
import type { ObsidianPlanRequest } from "./plan-types.js";
import type { ObsidianValidateRequest } from "./validation-types.js";
import type { ObsidianWriteRequest } from "./write-types.js";

export * from "./retrieval-types.js";
export { loadConfig } from "./config.js";
export * from "./commit-token-types.js";
export { createCommitTokenPolicy, DefaultCommitTokenService } from "./commit-token.js";
export { ObsidianCliAdapter } from "./obsidian-cli.js";
export { obsidianRetrieve } from "./retrieval-engine.js";
export { obsidianValidate } from "./validation-engine.js";
export { obsidianEdit } from "./edit-engine.js";
export { obsidianManage } from "./manage-engine.js";
export { obsidianPlan } from "./plan-engine.js";
export { obsidianWrite } from "./write-engine.js";
export * from "./edit-types.js";
export * from "./manage-types.js";
export * from "./plan-types.js";
export * from "./relationship-types.js";
export * from "./validation-types.js";
export * from "./write-types.js";

export interface RegisterObsidianVaultOptions extends LoadConfigOptions {
  backend?: ObsidianCliBackend | undefined;
  tokenService?: CommitTokenService | undefined;
}

export const OBSIDIAN_RETRIEVE_BUDGETS = ["tiny", "standard", "expanded"] as const;
export const OBSIDIAN_RETRIEVE_MODES = ["auto", "search", "context", "graph", "project", "note", "relationships"] as const;
export const OBSIDIAN_VALIDATE_TARGETS = ["existing_note", "proposed_content"] as const;

const Budget = StringEnum(OBSIDIAN_RETRIEVE_BUDGETS, {
  description: "Response budget profile. Valid values: tiny, standard, expanded.",
});
const Mode = StringEnum(OBSIDIAN_RETRIEVE_MODES, {
  description: "Retrieval mode. Valid values: auto, search, context, graph, project, note, relationships.",
});
const ValidationTarget = StringEnum(OBSIDIAN_VALIDATE_TARGETS, {
  description: "Validation target. Valid values: existing_note or proposed_content.",
});

const SelectedRefParam = Type.Object({
  path: Type.String({ description: "Vault-relative Markdown path returned by a previous obsidian_retrieve candidate selectedRef." }),
  title: Type.Optional(Type.String({ description: "Optional note title copied from the selectedRef." })),
}, { additionalProperties: false, description: "Exact selectedRef from a previous obsidian_retrieve response." });

const ScopeParam = Type.Object({
  folder: Type.Optional(Type.String({ description: "Optional vault-relative folder scope. Used as a seed signal only; never dumped." })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tag filters without requiring a full vault dump." })),
  properties: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), { description: "Optional property filters as key/value seeds." })),
  recent: Type.Optional(Type.Boolean({ description: "When true, use recent notes as bounded discovery seeds." })),
}, { additionalProperties: false, description: "Optional bounded discovery scope." });

const ObsidianRetrieveParams = Type.Object({
  query: Type.Optional(Type.String({ description: "Natural-language query, title, alias, tag, property, or project/topic phrase. For mode=note, this may only guide optional preview/explanation and never infers the path. For mode=relationships, query is not used to infer paths." })),
  mode: Type.Optional(Mode),
  path: Type.Optional(Type.String({ description: "Only for mode=note or mode=relationships: one explicit safe vault-relative Markdown note path. No absolute, traversal, hidden, .obsidian, wildcard, recursive, bulk/list, folder, or non-Markdown paths." })),
  selected: Type.Optional(Type.Array(SelectedRefParam, { description: "Only for context mode: exact selectedRef objects returned by prior obsidian_retrieve candidates or agentGuidance." })),
  scope: Type.Optional(ScopeParam),
  budget: Type.Optional(Budget),
  maxCandidates: Type.Optional(Type.Integer({ minimum: 1, maximum: 12, description: "Maximum ranked candidates to return (1-12, also capped by budget). Not accepted by mode=relationships." })),
  maxRelated: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Only for mode=relationships: bounded cap for relationship entries per category." })),
  includeBacklinks: Type.Optional(Type.Boolean({ description: "Only for mode=relationships: include inbound references when safely available; degrades instead of scanning broadly." })),
  includeOutgoing: Type.Optional(Type.Boolean({ description: "Only for mode=relationships: include outgoing links parsed from the explicit note. Defaults to true." })),
  includeSections: Type.Optional(Type.Boolean({ description: "Only for mode=relationships: include tiny bounded section relationship summaries. Defaults to false." })),
  explain: Type.Optional(Type.Boolean({ description: "When true, preserve concise ranking or relationship rationale where budget allows." })),
}, {
  additionalProperties: false,
  description: "obsidian_retrieve arguments. Supported top-level fields only: query, mode, path, selected, scope, budget, maxCandidates, maxRelated, includeBacklinks, includeOutgoing, includeSections, explain. Valid modes: auto, search, context, graph, project, note, relationships. Valid budgets: tiny, standard, expanded. Examples: search {\"query\":\"integrated gradients\",\"mode\":\"search\",\"budget\":\"standard\"}; graph {\"query\":\"Integrated Gradients connections\",\"mode\":\"graph\",\"budget\":\"expanded\"}; context {\"mode\":\"context\",\"query\":\"implementation details\",\"selected\":[{\"path\":\"Research/Integrated Gradients/index.md\",\"title\":\"Integrated Gradients\"}],\"budget\":\"standard\"}; note {\"mode\":\"note\",\"path\":\"Research/Integrated Gradients/index.md\",\"budget\":\"tiny\"}; relationships {\"mode\":\"relationships\",\"path\":\"Research/Integrated Gradients/index.md\",\"budget\":\"standard\",\"maxRelated\":10}.",
});

const ObsidianValidateParams = Type.Object({
  target: Type.Optional(ValidationTarget),
  path: Type.Optional(Type.String({ description: "For target=existing_note: one explicit safe vault-relative Markdown note path. No inference, folders, wildcards, traversal, hidden paths, .obsidian, bulk/list paths, or non-Markdown paths." })),
  content: Type.Optional(Type.String({ description: "For target=proposed_content: explicit non-empty Markdown content to validate. Proposed-content validation reads no vault files." })),
  expectedPath: Type.Optional(Type.String({ description: "Optional one explicit safe vault-relative Markdown path for path-aware advisory warnings. Unsafe values are refused before validation." })),
  maxIssues: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Positive bounded cap for returned validation issues. Errors are preferred before warning/info issues." })),
  budget: Type.Optional(Budget),
}, {
  additionalProperties: false,
  description: "obsidian_validate arguments. Supported top-level fields only: target, path, content, expectedPath, maxIssues, budget. target must be existing_note or proposed_content. existing_note reads only one explicit safe vault-relative Markdown path. proposed_content validates explicit Markdown content without vault access. Validation is read-only, bounded, redacted, workflow-neutral, and never mutates, scans broadly, rewrites links, opens UI, runs shell/network calls, creates templates, generates paths, or executes arbitrary commands.",
});

const ObsidianWriteParams = Type.Object({
  operation: Type.Optional(Type.String({ description: "Write operation. Supported semantic values are create, append, and create_folder; forbidden operations return safety_refusal." })),
  path: Type.Optional(Type.String({ description: "Explicit vault-relative Markdown path for create/append or folder path for create_folder. obsidian_write never infers destinations from query/topic text." })),
  content: Type.Optional(Type.String({ description: "Markdown content to create or append exactly as supplied. Must be non-empty for create/append and must be omitted for create_folder." })),
  dryRun: Type.Optional(Type.Boolean({ description: "When true or omitted, validate and preview without changing notes or folders. Set false only after explicit confirmation." })),
  confirmationToken: Type.Optional(Type.String({ description: "For token-required commits only: confirmation token returned by the matching dry-run preview. Tokens are redacted from status/docs and never inferred." })),
}, {
  additionalProperties: false,
  description: "obsidian_write arguments. Supported top-level fields only: operation, path, content, dryRun, confirmationToken. Supported operations: create, append, and create_folder. dryRun defaults to true. Markdown note operations require explicit safe vault-relative .md paths and non-empty content; create_folder requires an explicit safe vault-relative folder path and rejects content with CONTENT_NOT_ALLOWED. Token-required commits must reuse the confirmationToken from a matching dry-run preview. No overwrite, delete, trash, restore, rename, move, copy, open UI, shell, network, scan, discovery, or arbitrary CLI behavior is supported.",
});

const ObsidianEditParams = Type.Object({
  operation: Type.Optional(Type.String({ description: "Edit operation. Supported semantic values are replace_section, insert_under_heading, update_frontmatter, remove_frontmatter, and replace_exact_text; forbidden operations return safety_refusal." })),
  path: Type.Optional(Type.String({ description: "Explicit vault-relative Markdown path to an existing note. obsidian_edit never creates notes or infers destinations." })),
  heading: Type.Optional(Type.String({ description: "Exact ATX Markdown heading for section operations, for example ## Plan. Heading level and text must match after normalization." })),
  content: Type.Optional(Type.String({ description: "Markdown content for replace_section or insert_under_heading. Missing content is invalid; empty content is valid only for replace_section." })),
  property: Type.Optional(Type.String({ description: "Top-level YAML frontmatter property name for update_frontmatter or remove_frontmatter." })),
  value: Type.Optional(Type.Unknown({ description: "JSON-compatible value for update_frontmatter." })),
  oldText: Type.Optional(Type.String({ description: "Non-empty exact text span to replace for replace_exact_text. Matched literally; no regex, fuzzy, semantic, or inferred matching." })),
  newText: Type.Optional(Type.String({ description: "Explicit replacement text for replace_exact_text. May be an empty string when intentionally supplied." })),
  dryRun: Type.Optional(Type.Boolean({ description: "When true or omitted, validate and preview without changing notes. Set false only after explicit confirmation." })),
  confirmationToken: Type.Optional(Type.String({ description: "For token-required commits only: confirmation token returned by the matching dry-run preview. Tokens are bounded and never inferred." })),
}, {
  additionalProperties: false,
  description: "obsidian_edit arguments. Supported top-level fields only: operation, path, heading, content, property, value, oldText, newText, dryRun, confirmationToken. Supported operations: replace_section, insert_under_heading, update_frontmatter, remove_frontmatter, replace_exact_text. dryRun defaults to true. Path must be an explicit safe vault-relative Markdown path to an existing note. Token-required commits must reuse the confirmationToken from a matching dry-run preview. No create, full-note overwrite, delete, trash, restore, copy, rename, move, open UI, shell, network, regex, fuzzy, scan, or arbitrary CLI behavior is supported.",
});

const PlannedOperationParam = Type.Object({
  id: Type.Optional(Type.String({ description: "Optional non-empty unique operation id for issue references." })),
  tool: Type.Optional(Type.String({ description: "Canonical public tool name such as obsidian_write, obsidian_edit, obsidian_manage, obsidian_retrieve, or obsidian_validate." })),
  category: Type.Optional(Type.String({ description: "Canonical category alias: write, edit, manage, retrieve, or validate." })),
  operation: Type.Optional(Type.String({ description: "Mirrored public operation name. Supported operations are retrieve note/relationships, validate existing/proposed content, write create/append/create_folder, edit structured operations, and manage move/trash/restore/copy." })),
  path: Type.Optional(Type.String({ description: "Explicit safe vault-relative Markdown path or folder path where required by the mirrored operation." })),
  fromPath: Type.Optional(Type.String({ description: "Explicit safe vault-relative Markdown source path for move_note or copy_note." })),
  toPath: Type.Optional(Type.String({ description: "Explicit safe vault-relative Markdown destination path for move_note, restore_note, or copy_note." })),
  trashPath: Type.Optional(Type.String({ description: "Explicit safe vault-relative Markdown trash source path for restore_note." })),
  trashFolder: Type.Optional(Type.String({ description: "Optional explicit safe vault-relative trash folder for trash_note or restore_note." })),
  content: Type.Optional(Type.String({ description: "Explicit Markdown content for planned write operations or validate.proposed_content." })),
  heading: Type.Optional(Type.String({ description: "Exact ATX Markdown heading for section edit operations." })),
  property: Type.Optional(Type.String({ description: "Top-level frontmatter property for frontmatter edit operations." })),
  value: Type.Optional(Type.Unknown({ description: "JSON-compatible value for update_frontmatter." })),
  oldText: Type.Optional(Type.String({ description: "Exact oldText for replace_exact_text." })),
  newText: Type.Optional(Type.String({ description: "Explicit newText for replace_exact_text; may be empty." })),
  expectedPath: Type.Optional(Type.String({ description: "Optional explicit expected Markdown path for validate.proposed_content." })),
  maxRelated: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Only for retrieve.relationships planned entries." })),
  includeBacklinks: Type.Optional(Type.Boolean({ description: "Only for retrieve.relationships planned entries." })),
  includeOutgoing: Type.Optional(Type.Boolean({ description: "Only for retrieve.relationships planned entries." })),
  includeSections: Type.Optional(Type.Boolean({ description: "Only for retrieve.relationships planned entries." })),
  dryRun: Type.Optional(Type.Boolean({ description: "Ignored by obsidian_plan; dryRun:false produces a warning and never commits." })),
}, { additionalProperties: false, description: "One planned operation preview entry. obsidian_plan validates but never executes it." });

const ObsidianPlanParams = Type.Object({
  operations: Type.Optional(Type.Array(PlannedOperationParam, { description: "Ordered bounded array of planned operation objects." })),
  maxOperations: Type.Optional(Type.Integer({ minimum: 1, maximum: 25, description: "Optional request-local operation limit not exceeding 25." })),
  budget: Type.Optional(Budget),
  explain: Type.Optional(Type.Boolean({ description: "When true, may include concise deterministic rationale within budget." })),
}, {
  additionalProperties: false,
  description: "obsidian_plan arguments. Supported top-level fields only: operations, maxOperations, budget, and explain. Previews bounded ordered sequences of existing public operations without executing, committing, staging, batching, locking, rewriting links, scanning broadly, or creating commit tokens.",
});

const ObsidianManageParams = Type.Object({
  operation: Type.Optional(Type.String({ description: "Manage operation. Supported semantic values are exactly move_note, trash_note, restore_note, and copy_note; forbidden operations return safety_refusal." })),
  fromPath: Type.Optional(Type.String({ description: "For move_note and copy_note: explicit safe vault-relative Markdown source note path. obsidian_manage never infers sources from search, title, alias, or folder scans." })),
  toPath: Type.Optional(Type.String({ description: "For move_note, restore_note, and copy_note: explicit safe vault-relative Markdown destination note path. Destination must not exist and its parent folder must already exist." })),
  path: Type.Optional(Type.String({ description: "For trash_note only: explicit safe vault-relative Markdown source note path. obsidian_manage never infers sources, supports wildcards, or accepts bulk paths." })),
  trashPath: Type.Optional(Type.String({ description: "For restore_note only: explicit safe vault-relative Markdown source note path inside the selected/default trashFolder. obsidian_manage never infers restore sources." })),
  trashFolder: Type.Optional(Type.String({ description: "For trash_note and restore_note: optional explicit safe vault-relative folder path. Defaults to _Trash when omitted; must not be hidden, .obsidian, root, absolute, traversal, wildcard/bulk-looking, or extension-looking." })),
  dryRun: Type.Optional(Type.Boolean({ description: "When true or omitted, validate and preview without moving, trashing, restoring, or copying anything. Set false only after explicit confirmation." })),
  confirmationToken: Type.Optional(Type.String({ description: "For token-required commits only: confirmation token returned by the matching dry-run preview. Tokens are bounded and never inferred." })),
}, {
  additionalProperties: false,
  description: "obsidian_manage arguments. Supported top-level fields only: operation, fromPath, toPath, path, trashPath, trashFolder, dryRun, confirmationToken. Supported operations are exactly move_note, trash_note, restore_note, and copy_note. move_note moves or renames exactly one existing Markdown note from explicit safe fromPath to safe toPath. trash_note recoverably moves exactly one existing Markdown note from explicit path into configured/default trash folder or an explicit safe trashFolder. restore_note restores exactly one Markdown note from explicit trashPath inside the selected/default safe trashFolder to explicit safe toPath. copy_note copies exactly one existing Markdown note byte-for-byte from explicit safe fromPath to explicit safe toPath while leaving the source unchanged. Token-required commits must reuse the confirmationToken from a matching dry-run preview. dryRun defaults to true. No permanent delete, folder delete, folder copy, recursive/wildcard/bulk restore/delete/copy, non-Markdown restore/delete/copy, folder moves/restores, overwrite, link rewrite, open UI, shell, network, scan, discovery, or arbitrary CLI behavior is supported.",
});

export function registerObsidianVault(pi: Pick<ExtensionAPI, "registerTool" | "registerCommand">, options: RegisterObsidianVaultOptions = {}): void {
  const tokenService = options.tokenService ?? defaultCommitTokenService();
  pi.registerTool({
    name: "obsidian_retrieve",
    label: "Obsidian Retrieve",
    description: "Retrieve ranked Obsidian note candidates, agentGuidance, bounded selected-note context, one explicit note inspection, or one explicit-note relationship summary through the official Obsidian CLI. Read-only and candidate-first except explicit-path modes note and relationships. Args: query?: string; mode?: auto|search|context|graph|project|note|relationships; path?: string for mode=note or relationships; selected?: [{path,title?}]; scope?: {folder?,tags?,properties?,recent?}; budget?: tiny|standard|expanded; maxCandidates?: 1-12; maxRelated?: 1-50 for relationships; includeBacklinks/includeOutgoing/includeSections?: boolean for relationships; explain?: boolean. Valid examples: search {\"query\":\"integrated gradients\",\"mode\":\"search\",\"budget\":\"standard\"}; graph {\"query\":\"Integrated Gradients connections\",\"mode\":\"graph\",\"budget\":\"expanded\"}; context {\"mode\":\"context\",\"query\":\"implementation details\",\"selected\":[{\"path\":\"Research/Integrated Gradients/index.md\",\"title\":\"Integrated Gradients\"}],\"budget\":\"standard\"}; note {\"mode\":\"note\",\"path\":\"Research/Integrated Gradients/index.md\",\"budget\":\"tiny\"}; relationships {\"mode\":\"relationships\",\"path\":\"Research/Integrated Gradients/index.md\",\"budget\":\"standard\",\"maxRelated\":10}.",
    promptSnippet: "Use obsidian_retrieve first for Obsidian questions. Valid budgets: tiny, standard, expanded. For explicit note inspection, pass mode=note with one safe vault-relative Markdown path. For safe relationship summaries, pass mode=relationships with one safe vault-relative Markdown path.",
    promptGuidelines: [
      "Use obsidian_retrieve as the only Obsidian-facing retrieval tool; supported top-level request fields are query, mode, path, selected, scope, budget, maxCandidates, maxRelated, includeBacklinks, includeOutgoing, includeSections, and explain.",
      "Use obsidian_retrieve mode=search like {\"query\":\"integrated gradients\",\"mode\":\"search\",\"budget\":\"standard\"} for candidate discovery.",
      "Use obsidian_retrieve mode=graph like {\"query\":\"Integrated Gradients connections\",\"mode\":\"graph\",\"budget\":\"expanded\"} for bounded relationship summaries.",
      "Use obsidian_retrieve mode=context like {\"mode\":\"context\",\"query\":\"implementation details\",\"selected\":[{\"path\":\"Research/Integrated Gradients/index.md\",\"title\":\"Integrated Gradients\"}],\"budget\":\"standard\"} only for exact selectedRef paths returned by prior obsidian_retrieve output.",
      "Use obsidian_retrieve mode=note like {\"mode\":\"note\",\"path\":\"Research/Integrated Gradients/index.md\",\"budget\":\"tiny\"} only for explicit safe vault-relative Markdown note inspection; it never dumps full content by default.",
      "Use obsidian_retrieve mode=relationships like {\"mode\":\"relationships\",\"path\":\"Research/Integrated Gradients/index.md\",\"budget\":\"standard\",\"maxRelated\":10} only for bounded relationship summaries around one explicit Markdown note; it never scans broadly, crawls recursively, rewrites links, or infers mutation targets.",
      "Start with candidate discovery; do not ask for broad note, folder, or vault dumps.",
      "Read agentGuidance.resultState, bestMatch, confidence, contextRecommendation, and nextActions before deciding whether to answer or call context mode.",
      "Use obsidian_retrieve mode=project with scope.folder for bounded project summaries; outputs still remain candidate-first.",
      "obsidian_retrieve is read-only. It does not open Obsidian and does not write, append, rename, move, trash, copy, restore, rewrite links, or delete notes.",
    ],
    parameters: ObsidianRetrieveParams,
    async execute(_toolCallId: string, params: RetrievalRequest) {
      const config = await loadConfig(options);
      if (!options.backend && config.errors.length > 0) {
        return toolResponse(setupRequiredResponse(params, config, config.errors));
      }
      const backend = options.backend ?? new ObsidianCliAdapter({ cliPath: config.cliPath, vaultTarget: config.vaultTarget, cwd: config.vaultRoot, timeoutMs: config.cliTimeoutMs, autoLaunch: config.autoLaunch, launchWaitMs: config.launchWaitMs, obsidianAppPath: config.obsidianAppPath });
      const health = await backend.checkHealth({ allowAutoLaunch: config.autoLaunch });
      if (!health.available) {
        const errors = [...(!options.backend ? config.errors : []), ...health.errors, "Obsidian retrieval is unavailable. Open Obsidian manually, then retry."];
        return toolResponse(setupRequiredResponse(params, config, errors, health.warnings));
      }
      const retrieveDefaultBudget = (params.mode === "relationships" ? config.defaultRelationshipBudget : config.defaultRetrieveBudget) as BudgetProfile | undefined;
      const result = await obsidianRetrieve(backend, params, { defaultBudget: retrieveDefaultBudget, budgetChars: config.budgetChars });
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_validate",
    label: "Obsidian Validate",
    description: "Validate one explicit existing Markdown note or one explicit proposed Markdown content payload for objectively broken, risky, ambiguous, or agent-confusing Markdown. Read-only, workflow-neutral, bounded, and redacted. Supports target=existing_note with path, or target=proposed_content with content plus optional expectedPath, budget, and maxIssues. Never mutates, scans folders/vaults, rewrites links, opens UI, runs shell/network calls, creates templates, generates paths, or executes arbitrary commands.",
    promptSnippet: "Use obsidian_validate for read-only Markdown validation of one explicit note or explicit proposed content. It is advisory and workflow-neutral.",
    promptGuidelines: [
      "Use obsidian_validate when you need to check objectively broken, risky, ambiguous, or agent-confusing Markdown before suggesting edits or asking to commit content.",
      "Use target=existing_note with one explicit safe vault-relative Markdown path; obsidian_validate never infers paths from query text, search results, folders, tags, recents, aliases, or note titles.",
      "Use target=proposed_content with explicit non-empty Markdown content; proposed-content validation reads no vault files and does not require Obsidian setup.",
      "Optional expectedPath must be one explicit safe vault-relative Markdown path and is used only for path-aware advisory warnings such as title/path mismatch.",
      "Validation is advisory and workflow-neutral: missing frontmatter, tags, status/date/source fields, templates, PARA, Zettelkasten, daily-note structure, project-note structure, and other methodology choices are not errors.",
      "Suspicious absolute-looking, Windows absolute-looking, UNC-looking, traversal-looking, or .obsidian-looking strings inside Markdown content are warning-severity advisory issues; unsafe request path fields are refused before validation.",
      "Warning and info issues keep valid=true and must not block commits. valid=false is reserved for error-severity validation issues or request/setup failures where no valid content result was produced.",
      "obsidian_validate never creates, appends, edits, moves, trashes, restores, copies, deletes, creates folders, rewrites links, scans broadly, opens UI, runs shell/network calls, generates paths, uses templates, or executes arbitrary commands.",
      "Outputs must remain bounded and redacted: never expect full note/proposed content, vault roots, absolute paths, CLI paths, command paths, lock keys, shell details, network details, or arbitrary local filesystem details.",
    ],
    parameters: ObsidianValidateParams,
    async execute(_toolCallId: string, params: ObsidianValidateRequest) {
      if (params.target !== "existing_note") {
        const config = await loadConfig(options);
        const result = await obsidianValidate(undefined, params, { defaultBudget: config.defaultRetrieveBudget as BudgetProfile | undefined, defaultMaxIssues: config.maxValidationIssues });
        return toolResponse(result);
      }
      const preflight = await obsidianValidate(undefined, params, { setupErrors: ["Validation preflight completed without configured note access."] });
      if (preflight.status !== "setup_required") return toolResponse(preflight);
      const config = await loadConfig(options);
      if (!options.backend && config.errors.length > 0) {
        const result = await obsidianValidate(undefined, params, { defaultBudget: config.defaultRetrieveBudget as BudgetProfile | undefined, defaultMaxIssues: config.maxValidationIssues, setupErrors: config.errors });
        return toolResponse(result);
      }
      const backend = options.backend ?? new ObsidianCliAdapter({ cliPath: config.cliPath, vaultTarget: config.vaultTarget, cwd: config.vaultRoot, timeoutMs: config.cliTimeoutMs, autoLaunch: config.autoLaunch, launchWaitMs: config.launchWaitMs, obsidianAppPath: config.obsidianAppPath });
      const health = await backend.checkHealth({ allowAutoLaunch: config.autoLaunch });
      if (!health.available) {
        const errors = [...(!options.backend ? config.errors : []), ...health.errors, "Obsidian validation is unavailable. Open Obsidian manually, then retry existing-note validation."];
        return toolResponse(setupRequiredValidationResponse(params, errors, health.warnings, preflight.path));
      }
      const result = await obsidianValidate(backend, params, { defaultBudget: config.defaultRetrieveBudget as BudgetProfile | undefined, defaultMaxIssues: config.maxValidationIssues });
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_plan",
    label: "Obsidian Plan Preview",
    description: "Preview a bounded ordered sequence of existing public Obsidian operations without executing anything. Read-only. Supports planned retrieve.note, retrieve.relationships, validate existing/proposed content, write create/append/create_folder, edit structured operations, and manage move/trash/restore/copy. Never commits, stages, batches, transactionally applies, creates commit tokens, writes files, rewrites links, scans broadly, opens UI, runs shell/network calls, or creates locks/reservations.",
    promptSnippet: "Use obsidian_plan to preview a sequence of explicit safe operations before asking for individual dry-runs. It never executes or commits.",
    promptGuidelines: [
      "Use obsidian_plan only for bounded preview of explicit planned operations. It is read-only and cannot commit, batch-run, stage, or transactionally apply operations.",
      "Each planned operation must mirror an existing public capability: retrieve note, retrieve.relationships, validate existing/proposed content, write create/append/create_folder, edit replace_section/insert_under_heading/update_frontmatter/remove_frontmatter/replace_exact_text, or manage move_note/trash_note/restore_note/copy_note.",
      "Planned retrieve.relationships entries require one explicit safe vault-relative Markdown path and follow relationship safety rules: no broad backlink scan, no recursive graph expansion, no full note dump, no link rewriting, and degraded signals when data is unavailable.",
      "dryRun:false in a planned operation is ignored and reported as a warning; obsidian_plan never passes dryRun:false to underlying tools.",
      "Plan preview may perform only targeted checks for explicit safe paths and virtual in-memory effects. It never scans folders or the vault broadly, expands wildcards, infers destinations, rewrites links, shells out, uses network, opens UI, or creates commit tokens.",
      "If valid=true, ask for individual existing-tool dry-runs before any commit. If valid=false, revise the plan; obsidian_plan cannot execute it.",
    ],
    parameters: ObsidianPlanParams,
    async execute(_toolCallId: string, params: ObsidianPlanRequest) {
      const config = await loadConfig(options);
      const result = await obsidianPlan(params, { vaultRoot: config.vaultRoot });
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_write",
    label: "Obsidian Write",
    description: "Create or append Markdown notes, or create folders, in Obsidian using explicit safe vault-relative paths. Separate from obsidian_retrieve and obsidian_edit. Supports operation=create, operation=append, or operation=create_folder, plus path, content for create/append only, and dryRun. dryRun defaults to true. Never overwrites, deletes, trashes, restores, copies, renames, moves, opens the UI, runs shell/network calls, scans the vault, discovers filesystem structure, or executes arbitrary CLI commands.",
    promptSnippet: "Use obsidian_write only for explicit safe Markdown create/append or folder create_folder requests. Prefer dryRun=true previews before committing with dryRun=false.",
    promptGuidelines: [
      "Use obsidian_write only when the user wants to create a new Markdown note, append to an existing Markdown note, or create an explicit safe vault-relative folder.",
      "Use obsidian_write with dryRun=true or omitted to preview writes/folder creation; set dryRun=false only after explicit user confirmation or clear instruction to commit. If the preview returns confirmationToken, pass that exact token on the matching dryRun=false request.",
      "For Markdown notes, obsidian_write requires operation=create or operation=append, an explicit safe vault-relative .md path, and non-empty content; obsidian_write never infers paths from vague topic instructions.",
      "For folders, obsidian_write requires operation=create_folder and an explicit safe vault-relative folder path; omit content, because supplied content is rejected with CONTENT_NOT_ALLOWED and no file is created or modified.",
      "obsidian_write appends Markdown exactly as supplied for append; include desired leading newlines, headings, or separators in content.",
      "obsidian_write create/append dry-run previews may include advisory validation metadata for supplied content; warning/info issues do not block commits and append validation checks only supplied appended content in this batch.",
      "obsidian_write refuses overwrite, delete, trash, restore, copy, rename, move, open UI, shell, network, scan, discovery, and arbitrary CLI requests with safety_refusal.",
      "Use obsidian_retrieve for reading/searching Obsidian; obsidian_retrieve remains read-only. Use obsidian_edit only for controlled edits to existing Markdown notes.",
    ],
    parameters: ObsidianWriteParams,
    async execute(_toolCallId: string, params: ObsidianWriteRequest) {
      const config = await loadConfig(options);
      const result = await obsidianWrite(params, { vaultRoot: config.vaultRoot, tokenPolicy: config.commitTokenPolicy, tokenService, maxPreviewChars: config.maxPreviewChars, writeDryRunValidationEnabled: config.writeDryRunValidationEnabled, appendDryRunValidationEnabled: config.appendDryRunValidationEnabled });
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_edit",
    label: "Obsidian Edit",
    description: "Safely edit existing Markdown notes in Obsidian using explicit structured operations. Separate from obsidian_retrieve and obsidian_write. Supports replace_section, insert_under_heading, update_frontmatter, remove_frontmatter, and replace_exact_text. dryRun defaults to true. Requires an explicit safe vault-relative Markdown path to an existing note. Never creates notes, overwrites full notes, deletes, trashes, restores, copies, renames, moves, opens the UI, runs shell/network calls, scans the vault, or executes arbitrary CLI commands.",
    promptSnippet: "Use obsidian_edit only for explicit safe structured edits to existing Markdown notes. Prefer dryRun=true previews before committing with dryRun=false.",
    promptGuidelines: [
      "Use obsidian_edit only when the user wants to edit an existing Markdown note at an explicit safe vault-relative .md path.",
      "Use obsidian_edit with dryRun=true or omitted to preview structured edits; set dryRun=false only after explicit user confirmation or clear instruction to commit. For token-required edits, pass the exact confirmationToken returned by the matching dry-run preview.",
      "obsidian_edit requires operation, path, and operation-specific fields: heading/content for replace_section or insert_under_heading; property/value for update_frontmatter; property for remove_frontmatter; oldText/newText for replace_exact_text.",
      "For replace_exact_text, oldText must match exactly once with no regex, fuzzy, semantic, normalized, or inferred matching; duplicate or missing oldText fails without mutation.",
      "Section headings must be exact ATX Markdown headings such as ## Plan; duplicate matching headings return ambiguity and must not be resolved automatically.",
      "Frontmatter edits affect only top-of-file YAML frontmatter; update_frontmatter may create frontmatter, remove_frontmatter requires an existing property.",
      "obsidian_edit refuses create, full-note overwrite, delete, trash, restore, copy, rename, move, open UI, shell, network, regex, fuzzy, scan, and arbitrary CLI requests with safety_refusal.",
      "Use obsidian_write only for create/append/create_folder; use obsidian_manage only for move_note, trash_note, restore_note, or copy_note; use obsidian_retrieve only for reading/searching. Keep retrieval read-only and keep folder creation/move/trash/restore/copy management out of obsidian_edit."
    ],
    parameters: ObsidianEditParams,
    async execute(_toolCallId: string, params: ObsidianEditRequest) {
      const config = await loadConfig(options);
      const result = await obsidianEdit(params, { vaultRoot: config.vaultRoot, tokenPolicy: config.commitTokenPolicy, tokenService, maxPreviewChars: config.maxPreviewChars });
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_manage",
    label: "Obsidian Manage",
    description: "Safely move, rename, recoverably trash, restore, or copy exactly one existing Markdown note in Obsidian using explicit safe vault-relative paths. Separate from obsidian_retrieve, obsidian_write, and obsidian_edit. Supports only operation=move_note, operation=trash_note, operation=restore_note, or operation=copy_note. move_note uses fromPath/toPath; trash_note uses path plus optional trashFolder defaulting to _Trash; restore_note uses explicit trashPath inside selected/default trashFolder plus explicit toPath; copy_note uses explicit fromPath/toPath and preserves bytes exactly. dryRun defaults to true. Never permanently deletes, deletes folders, processes recursive/wildcard/bulk paths, overwrites, rewrites links, opens the UI, runs shell/network calls, scans the vault, discovers filesystem structure, or executes arbitrary CLI commands.",
    promptSnippet: "Use obsidian_manage only for explicit safe single-note move/rename, recoverable trash, restore-from-trash, or copy requests. Prefer dryRun=true previews before committing with dryRun=false.",
    promptGuidelines: [
      "Use obsidian_manage only when the user wants to move/rename exactly one existing Markdown note from explicit safe vault-relative fromPath to toPath, recoverably trash exactly one Markdown note from explicit safe path, restore exactly one Markdown note from explicit safe trashPath inside trashFolder to explicit safe toPath, or copy exactly one existing Markdown note from explicit safe fromPath to explicit safe toPath.",
      "obsidian_manage supports only operation=move_note, operation=trash_note, operation=restore_note, and operation=copy_note. Do not use it for permanent delete, folder delete, recursive delete/restore/copy, wildcard delete/restore/copy, bulk delete/restore/copy, non-Markdown delete/restore/copy, folder moves/restores/copies, multi-note moves/restores/copies, overwrite, link rewriting, UI open, shell, network, scan, discovery, or arbitrary commands.",
      "Use obsidian_manage with dryRun=true or omitted to preview; set dryRun=false only after explicit user confirmation or clear instruction to commit. Pass the exact confirmationToken returned by the matching dry-run preview for all default management commits.",
      "move_note requires fromPath and toPath to be different safe vault-relative .md paths. The source note must already exist, the destination must not exist, and the destination parent folder must already exist.",
      "trash_note requires path to be an explicit safe vault-relative .md note path. Optional trashFolder must be an explicit safe vault-relative folder path; when omitted it defaults to _Trash.",
      "trash_note creates the safe trash folder only when committed with dryRun=false, moves exactly one Markdown note to the computed trash path, and returns conflict/TRASH_TARGET_EXISTS without overwrite, suffixing, or auto-rename if the target already exists.",
      "restore_note requires trashPath to be an explicit safe vault-relative .md note path inside the selected/default trashFolder and toPath to be an explicit safe vault-relative .md destination whose parent already exists.",
      "restore_note never creates destination parents, overwrites, suffixes, auto-renames, copies, rewrites links, searches the trash folder, restores folders, or restores non-Markdown files.",
      "copy_note requires fromPath and toPath to be different explicit safe vault-relative .md paths. The source note must already exist as one regular Markdown file, the destination must not exist, and the destination parent folder must already exist.",
      "copy_note copies exactly one Markdown note byte-for-byte while leaving the source unchanged; it never creates destination parents, overwrites, suffixes, auto-renames, rewrites links, scans for alternatives, copies folders, copies recursively, expands wildcards, or copies multiple notes.",
      "If the destination parent folder is missing for move_note, restore_note, or copy_note, obsidian_manage returns status=not_found with error.code=PARENT_MISSING; create the folder separately with obsidian_write create_folder only if the user requests it.",
      "obsidian_manage responses expose only vault-relative paths and never expose the vault root, absolute source/destination/trash/restore/copy paths, absolute CLI paths, or lock keys.",
      "Keep obsidian_retrieve read-only, obsidian_write limited to create/append/create_folder, and obsidian_edit limited to controlled content edits of existing Markdown notes.",
    ],
    parameters: ObsidianManageParams,
    async execute(_toolCallId: string, params: ObsidianManageRequest) {
      const config = await loadConfig(options);
      const result = await obsidianManage(params, { vaultRoot: config.vaultRoot, tokenPolicy: config.commitTokenPolicy, tokenService, defaultTrashFolder: config.defaultTrashFolder });
      return toolResponse(result);
    },
  });

  pi.registerCommand("obsidian-vault", {
    description: "Show configured Obsidian CLI retrieval, write, structured edit, note management, and plan preview status",
    handler: async (_args: string, ctx: { ui: { notify(message: string, level?: string): void } }) => {
      const backend = await backendFromOptions(options);
      const config = await loadConfig(options);
      const status = config ? statusFromConfig(config) : undefined;
      const writeStatus = config ? await writeStatusFromConfig(config) : undefined;
      const editStatus = config ? await editStatusFromConfig(config) : undefined;
      const manageStatus = config ? await manageStatusFromConfig(config) : undefined;
      const health = await backend.checkHealth({ allowAutoLaunch: false });
      const configSummary = statusConfigSummary(config, tokenService.isAvailable());
      const extraSensitivePaths = [health.cliPath, options.configPath].filter((value): value is string => Boolean(value));
      const capabilities = buildCapabilityRows({ health, status, writeStatus, editStatus, manageStatus, hasInjectedBackend: Boolean(options.backend) });
      const lines = [
        `Obsidian Vault: ${health.available ? "CLI available" : "CLI unavailable"}`,
        status ? `Source: ${status.source}` : "Source: injected backend",
        `CLI: ${safeStatusCliPath(health.cliPath)}`,
      ];
      if (status?.vaultRoot) lines.push("Vault path: configured");
      else lines.push("Vault path: not configured locally");
      if (status?.vaultTarget || health.vaultTarget) lines.push(`Vault target: ${status?.vaultTarget ?? health.vaultTarget}`);
      if (writeStatus) lines.push(`Writes: ${writeStatus.writable ? "available" : "unavailable"}`);
      if (editStatus) lines.push(`obsidian_edit: ${editStatus.status}`);
      if (manageStatus) lines.push(`obsidian_manage: ${manageStatus.status}`);
      if (capabilities.some((capability) => capability.name === "plan")) lines.push(`obsidian_plan: ${capabilities.find((capability) => capability.name === "plan")?.state ?? "unavailable"}`);
      lines.push(`Commit tokens: ${configSummary.tokenSupport} (${configSummary.tokenRequirementMode}, ttl ${configSummary.tokenTtlSeconds}s)`);
      lines.push(`Defaults: retrieveBudget=${configSummary.defaultRetrieveBudget}, relationshipBudget=${configSummary.defaultRelationshipBudget}, maxPreviewChars=${configSummary.maxPreviewChars}, maxValidationIssues=${configSummary.maxValidationIssues}, trashFolder=${configSummary.defaultTrashFolder}`);
      lines.push(`Dry-run validation: create=${configSummary.writeDryRunValidationEnabled ? "enabled" : "disabled"}, append=${configSummary.appendDryRunValidationEnabled ? "enabled" : "disabled"}`);
      lines.push("", "Capabilities:");
      for (const capability of capabilities) lines.push(`- ${capability.name}: ${capability.state} — ${redactStatusPath(capability.summary, config, extraSensitivePaths)}`);
      for (const error of [...(status?.errors ?? []), ...health.errors, ...(writeStatus?.errors ?? []), ...(editStatus?.errors ?? []), ...(manageStatus?.errors ?? [])]) lines.push(`Error: ${redactStatusPath(error, config, extraSensitivePaths)}`);
      for (const warning of [...health.warnings, ...(writeStatus?.warnings ?? []), ...(editStatus?.warnings ?? []), ...(manageStatus?.warnings ?? []), ...configSummary.warnings]) lines.push(`Warning: ${redactStatusPath(warning, config, extraSensitivePaths)}`);
      const allAvailable = capabilities.every((capability) => capability.state === "available");
      ctx.ui.notify(lines.join("\n"), allAvailable ? "info" : "warning");
    },
  });
}

type CapabilityState = "available" | "degraded" | "unavailable";
interface CapabilityRow {
  name: "retrieve" | "write" | "edit" | "manage" | "plan";
  state: CapabilityState;
  summary: string;
}

function buildCapabilityRows(input: {
  health: ObsidianCliHealth;
  status: VaultStatus | undefined;
  writeStatus: WriteVaultStatus | undefined;
  editStatus: EditVaultStatus | undefined;
  manageStatus: ManageVaultStatus | undefined;
  hasInjectedBackend: boolean;
}): CapabilityRow[] {
  const retrievalConfigured = input.hasInjectedBackend || Boolean(input.status?.vaultRoot || input.status?.vaultTarget || input.health.vaultTarget);
  const retrieveState: CapabilityState = !retrievalConfigured || !input.health.available ? "unavailable" : input.health.warnings.length > 0 ? "degraded" : "available";
  const retrieveSummary = retrieveState === "available"
    ? "read-only retrieval health check passed"
    : retrieveState === "degraded"
      ? "read-only retrieval is reachable with warnings"
      : "read-only retrieval is not currently reachable or configured";

  const writeState: CapabilityState = input.writeStatus?.writable ? "available" : input.writeStatus?.configured ? "degraded" : "unavailable";
  const writeSummary = writeState === "available" ? "local vault path configured for create, append, and create_folder" : writeState === "degraded" ? "local vault path is configured but write health is degraded" : "local vault path is required for obsidian_write";

  return [
    { name: "retrieve", state: retrieveState, summary: retrieveSummary },
    { name: "write", state: writeState, summary: writeSummary },
    { name: "edit", state: input.editStatus?.status ?? "unavailable", summary: capabilitySummary("obsidian_edit", input.editStatus?.status ?? "unavailable") },
    { name: "manage", state: input.manageStatus?.status ?? "unavailable", summary: capabilitySummary("obsidian_manage", input.manageStatus?.status ?? "unavailable") },
    { name: "plan", state: writeState === "available" ? "available" : writeState === "degraded" ? "degraded" : "unavailable", summary: writeState === "available" ? "local vault path configured for read-only operation plan preview" : writeState === "degraded" ? "local vault path is configured but plan preview targeted checks may be degraded" : "local vault path is required for targeted obsidian_plan state checks" },
  ];
}

function capabilitySummary(surface: "obsidian_edit" | "obsidian_manage", state: CapabilityState): string {
  if (state === "available") return `local vault path configured for ${surface}`;
  if (state === "degraded") return `local vault path is configured but ${surface} health is degraded`;
  return `local vault path is required for ${surface}`;
}

async function backendFromOptions(options: RegisterObsidianVaultOptions): Promise<ObsidianCliBackend> {
  if (options.backend) return options.backend;
  const config = await loadConfig(options);
  return new ObsidianCliAdapter({ cliPath: config.cliPath, vaultTarget: config.vaultTarget, cwd: config.vaultRoot, timeoutMs: config.cliTimeoutMs, autoLaunch: config.autoLaunch, launchWaitMs: config.launchWaitMs, obsidianAppPath: config.obsidianAppPath });
}

function safeStatusCliPath(cliPath: string): string {
  const clean = cliPath.trim();
  if (isAbsoluteFilesystemPath(clean)) return "configured absolute path redacted";
  return clean || "unknown";
}

function redactStatusPath(message: string, config: VaultConfig | undefined, extraSensitiveValues: string[] = []): string {
  let result = message;
  const exactRedactions = [
    { value: config?.rawVaultPath, replacement: "[vault path]" },
    { value: config?.vaultRoot, replacement: "[vault path]" },
    { value: isAbsoluteFilesystemPath(config?.cliPath ?? "") ? config?.cliPath : undefined, replacement: "[path]" },
    ...extraSensitiveValues.filter(isAbsoluteFilesystemPath).map((value) => ({ value, replacement: "[path]" })),
  ]
    .filter((item): item is { value: string; replacement: string } => Boolean(item.value))
    .sort((a, b) => b.value.length - a.value.length);
  for (const { value, replacement } of exactRedactions) {
    result = result.split(value).join(replacement);
  }
  return result
    .replace(/[A-Za-z]:\\[^\r\n)]+/g, "[path]")
    .replace(/\/(?:[^\r\n:)]+\/)+[^\r\n:)]+/g, "[path]");
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function setupRequiredResponse(params: RetrievalRequest, config: VaultConfig | undefined, errors: string[], extraWarnings: string[] = []): ObsidianRetrieveOutput {
  const profile = params.budget ?? config?.defaultBudget ?? "standard";
  const budget = budgetForProfile(profile, config?.budgetChars);
  const warnings = [...errors, ...extraWarnings];
  const guidance: AgentGuidance = {
    resultState: "no_match",
    bestMatch: null,
    confidence: {
      level: "none",
      ambiguous: false,
      rationale: "Obsidian retrieval is not available until setup or app launch succeeds.",
    },
    contextRecommendation: {
      recommended: false,
      reason: "Do not request context until Obsidian is configured and reachable.",
      selected: [],
      mode: "none",
      answerScope: "clarify_first",
    },
    alternatives: [],
    nextActions: [
      {
        priority: 1,
        action: "stop",
        label: "Configure the Obsidian vault path or open Obsidian, then retry obsidian_retrieve.",
      },
    ],
  };
  const output: ObsidianRetrieveOutput = {
    mode: resolveOutputMode(params),
    query: params.query,
    candidates: [],
    budget: { profile, maxChars: budget.totalChars, usedChars: 0, truncated: false, omissions: [] },
    warnings,
    nextActions: guidance.nextActions.map((action) => action.label),
    agentGuidance: guidance,
  };
  return { ...output, budget: { ...output.budget, usedChars: Math.min(JSON.stringify(output).length, budget.totalChars) } };
}

function resolveOutputMode(params: RetrievalRequest): ResolvedRetrievalMode {
  if (params.mode === "context" || params.mode === "graph" || params.mode === "project" || params.mode === "search" || params.mode === "note" || params.mode === "relationships") return params.mode;
  if (params.selected && params.selected.length > 0) return "context";
  if (params.scope?.folder) return "project";
  return "search";
}

function toolResponse(details: unknown): { content: Array<{ type: "text"; text: string }>; details: unknown } {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
  };
}

export default function obsidianVaultExtension(pi: ExtensionAPI): void {
  registerObsidianVault(pi);
}
