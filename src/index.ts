import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { Type } from "typebox";
import { editStatusFromConfig, forgetRememberedVaultPath, loadConfig, manageStatusFromConfig, rememberedVaultStatus, setRememberedVaultPath, statusFromConfig, writeStatusFromConfig, type LoadConfigOptions, type VaultConfig, type VaultStatus } from "./config.js";
import { budgetForProfile } from "./context-packer.js";
import { DesktopObsidianAppController, type ObsidianAppController, type ObsidianAppReadyResult } from "./obsidian-app.js";
import { classifyObsidianCliSetupFailure, ObsidianCliAdapter, type ObsidianCliSetupClassification } from "./obsidian-cli.js";
import { obsidianRetrieve } from "./retrieval-engine.js";
import { obsidianValidate, setupRequiredValidationResponse } from "./validation-engine.js";
import { obsidianEdit } from "./edit-engine.js";
import { obsidianManage } from "./manage-engine.js";
import { obsidianDestroy } from "./destroy-engine.js";
import { obsidianPlan } from "./plan-engine.js";
import { obsidianWrite } from "./write-engine.js";
import type { AgentGuidance, BudgetProfile, ObsidianCliBackend, ObsidianRetrieveOutput, ResolvedRetrievalMode, RetrievalRequest } from "./retrieval-types.js";
import type { ObsidianEditOutput, ObsidianEditRequest } from "./edit-types.js";
import type { ObsidianManageOutput, ObsidianManageRequest } from "./manage-types.js";
import type { ObsidianDestroyOutput, ObsidianDestroyRequest } from "./destroy-types.js";
import type { ObsidianPlanOutput, ObsidianPlanRequest } from "./plan-types.js";
import type { ObsidianValidateRequest } from "./validation-types.js";
import type { ObsidianWriteOutput, ObsidianWriteRequest } from "./write-types.js";

export * from "./retrieval-types.js";
export { loadConfig } from "./config.js";
export { DesktopObsidianAppController } from "./obsidian-app.js";
export type { ObsidianAppController, ObsidianAppReadyResult } from "./obsidian-app.js";
export { ObsidianCliAdapter } from "./obsidian-cli.js";
export { obsidianRetrieve } from "./retrieval-engine.js";
export { obsidianValidate } from "./validation-engine.js";
export { obsidianEdit } from "./edit-engine.js";
export { obsidianManage } from "./manage-engine.js";
export { obsidianDestroy } from "./destroy-engine.js";
export { obsidianPlan } from "./plan-engine.js";
export { obsidianWrite } from "./write-engine.js";
export * from "./edit-types.js";
export * from "./manage-types.js";
export * from "./destroy-types.js";
export * from "./plan-types.js";
export * from "./relationship-types.js";
export * from "./validation-types.js";
export * from "./write-types.js";

export interface RegisterObsidianVaultOptions extends LoadConfigOptions {
  backend?: ObsidianCliBackend | undefined;
  appController?: ObsidianAppController | undefined;
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
  description: "obsidian_validate arguments. Supported top-level fields only: target, path, content, expectedPath, maxIssues, budget. target must be existing_note or proposed_content. existing_note reads only one explicit safe vault-relative Markdown path and may trigger Obsidian app readiness preflight. proposed_content validates explicit Markdown content without vault access. Validation is read-only, bounded, redacted, workflow-neutral, and never mutates, scans broadly, rewrites links, automates UI, runs shell/network calls, creates templates, generates paths, or executes arbitrary commands.",
});

const ObsidianWriteParams = Type.Object({
  operation: Type.Optional(Type.String({ description: "Write operation. Supports create, append, and create_folder." })),
  path: Type.Optional(Type.String({ description: "Vault-relative Markdown path for create/append, or folder path for create_folder. For create, title can be used instead." })),
  title: Type.Optional(Type.String({ description: "Optional note title for create when path is omitted; obsidian_write turns it into a safe .md filename." })),
  folderHint: Type.Optional(Type.String({ description: "Optional vault-relative folder hint for inferred create paths." })),
  content: Type.Optional(Type.String({ description: "Markdown content to create or append exactly as supplied. Required for create/append and omitted for create_folder." })),
  dryRun: Type.Optional(Type.Boolean({ description: "Set true only when the user asks to preview/check without changing the vault. Otherwise the extension previews internally, asks for human approval, then commits." })),
}, {
  additionalProperties: false,
  description: "obsidian_write creates/appends Markdown notes or creates folders. For mutations, the extension previews the exact proposed change and asks the human before committing. create can infer a safe path from title/content; hard safety rails still block unsafe paths, overwrites, deletes, shell/network, and arbitrary commands.",
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
  dryRun: Type.Optional(Type.Boolean({ description: "Set true only when the user asks to preview/check without changing the vault. Otherwise the extension previews internally, asks for human approval, then commits." })),
}, {
  additionalProperties: false,
  description: "obsidian_edit edits existing Markdown notes with structured operations. For mutations, the extension previews the exact proposed change and asks the human before committing. Use dryRun=true only for preview-only requests. Hard safety rails still block full-note overwrite, delete, rename/move, shell/network, regex/fuzzy edits, and arbitrary commands.",
});

const PlannedOperationParam = Type.Object({
  id: Type.Optional(Type.String({ description: "Optional non-empty unique operation id for issue references." })),
  tool: Type.Optional(Type.String({ description: "Canonical non-destructive public tool name such as obsidian_write, obsidian_edit, obsidian_manage, obsidian_retrieve, or obsidian_validate." })),
  category: Type.Optional(Type.String({ description: "Canonical non-destructive category alias: write, edit, manage, retrieve, or validate." })),
  operation: Type.Optional(Type.String({ description: "Mirrored non-destructive public operation name. Supported operations are retrieve note/relationships, validate existing/proposed content, write create/append/create_folder, edit structured operations, and manage move/trash/restore/copy." })),
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
  description: "obsidian_plan arguments. Supported top-level fields only: operations, maxOperations, budget, and explain. Previews bounded ordered sequences of supported non-destructive public operations without executing, committing, staging, batching, locking, rewriting links, scanning broadly, or writing files.",
});

const ObsidianConfigParams = Type.Object({
  operation: Type.Optional(Type.String({ description: "Config operation. Supports set_vault, forget_vault, and status." })),
  vaultPath: Type.Optional(Type.String({ description: "Local Obsidian vault folder path to remember for future Pi sessions. Required for set_vault." })),
}, {
  additionalProperties: false,
  description: "Remember, forget, or inspect the single Obsidian vault path setting. This is only needed when auto-detection cannot find the vault.",
});

const ObsidianManageParams = Type.Object({
  operation: Type.Optional(Type.String({ description: "Manage operation. Supported semantic values are exactly move_note, trash_note, restore_note, and copy_note; forbidden operations return safety_refusal." })),
  fromPath: Type.Optional(Type.String({ description: "For move_note and copy_note: explicit safe vault-relative Markdown source note path. obsidian_manage never infers sources from search, title, alias, or folder scans." })),
  toPath: Type.Optional(Type.String({ description: "For move_note, restore_note, and copy_note: explicit safe vault-relative Markdown destination note path. Destination must not exist and its parent folder must already exist." })),
  path: Type.Optional(Type.String({ description: "For trash_note only: explicit safe vault-relative Markdown source note path. obsidian_manage never infers sources, supports wildcards, or accepts bulk paths." })),
  trashPath: Type.Optional(Type.String({ description: "For restore_note only: explicit safe vault-relative Markdown source note path inside the selected/default trashFolder. obsidian_manage never infers restore sources." })),
  trashFolder: Type.Optional(Type.String({ description: "For trash_note and restore_note: optional explicit safe vault-relative folder path. Defaults to _Trash when omitted; must not be hidden, .obsidian, root, absolute, traversal, wildcard/bulk-looking, or extension-looking." })),
  dryRun: Type.Optional(Type.Boolean({ description: "Set true only when the user asks to preview/check without changing the vault. Otherwise the extension previews internally, asks for human approval, then commits." })),
}, {
  additionalProperties: false,
  description: "obsidian_manage moves/renames, recoverably trashes, restores, or copies one Markdown note. For mutations, the extension previews the exact proposed change and asks the human before committing. Use dryRun=true only for preview-only requests. Hard safety rails still block permanent delete, folders, bulk/wildcard/recursive actions, overwrites, link rewrites, shell/network, and arbitrary commands.",
});

const ObsidianDestroyParams = Type.Object({
  operation: Type.Optional(Type.String({ description: "Destructive operation. Supports delete_note, delete_folder, replace_note, and empty_trash." })),
  path: Type.Optional(Type.String({ description: "For delete_note/replace_note: explicit safe vault-relative Markdown note path. For delete_folder: explicit safe vault-relative folder path." })),
  content: Type.Optional(Type.String({ description: "For replace_note only: full replacement Markdown content. Missing/empty content is refused." })),
  dryRun: Type.Optional(Type.Boolean({ description: "Set true only when the user asks to preview/check without changing the vault. Otherwise the extension previews internally and asks for destructive approval before committing." })),
}, {
  additionalProperties: false,
  description: "obsidian_destroy permanently deletes one note, permanently deletes one explicit folder recursively, replaces an entire existing note, or empties the default trash folder. Destructive auto-approval is separate from auto-write. Hard rails still block unsafe paths, vault root deletion, .obsidian, hidden paths, wildcards/bulk paths, symlinks/special files, shell/network, and arbitrary commands.",
});

export function registerObsidianVault(pi: Pick<ExtensionAPI, "registerTool" | "registerCommand">, options: RegisterObsidianVaultOptions = {}): void {
  const approvalState: MutationApprovalState = { autoWriteForSession: false, autoDestroyForSession: false };
  const appState: ObsidianAppSessionState = {};
  const appController = options.appController ?? new DesktopObsidianAppController({ env: options.env, platform: options.platform });

  pi.registerTool({
    name: "obsidian_config",
    label: "Obsidian Config",
    description: "Remember, forget, or inspect the single Obsidian vault path setting. Use this only when auto-detection cannot find the vault or the user asks to change vaults.",
    promptSnippet: "Use obsidian_config set_vault when the user gives you their Obsidian vault folder path. This is the only normal persistent setting.",
    promptGuidelines: [
      "Use operation=set_vault with vaultPath when the user tells you where their Obsidian vault folder is.",
      "Use operation=forget_vault when the user wants to forget the remembered vault and return to auto-detection.",
      "Use operation=status to check whether the vault is remembered, auto-detected, or missing.",
      "Do not ask users to edit env vars or config files; the agent can remember the vault path through this tool.",
    ],
    parameters: ObsidianConfigParams,
    async execute(_toolCallId: string, params: { operation?: string | undefined; vaultPath?: string | undefined }) {
      const operation = params.operation?.trim();
      if (operation === "set_vault") {
        const result = await setRememberedVaultPath(params.vaultPath ?? "", options);
        if (result.status === "success") {
          const config = effectiveAppConfig(await loadConfig(options), appState);
          const appReady = await ensureObsidianAppForTool("obsidian_config", config, options, appController, true);
          if (!appReady.ok) return toolResponse({ ...result, warnings: [...result.warnings, ...appReady.warnings, appReady.message], errors: [...result.errors, ...appReady.errors] });
        }
        return toolResponse(result);
      }
      if (operation === "forget_vault") return toolResponse(await forgetRememberedVaultPath(options));
      if (operation === "status" || operation === undefined || operation === "") return toolResponse(await rememberedVaultStatus(options));
      return toolResponse({ status: "invalid", operation, message: "obsidian_config supports operation=set_vault, operation=forget_vault, or operation=status.", warnings: [], errors: ["Unsupported obsidian_config operation."] });
    },
  });

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
      "obsidian_retrieve is read-only. It may auto-open the configured Obsidian vault if the app is closed, but it does not write, append, rename, move, trash, copy, restore, rewrite links, or delete notes.",
    ],
    parameters: ObsidianRetrieveParams,
    async execute(_toolCallId: string, params: RetrievalRequest) {
      const config = effectiveAppConfig(await loadConfig(options), appState);
      if (!options.backend && config.errors.length > 0) {
        return toolResponse(setupRequiredResponse(params, config, config.errors));
      }
      const appReady = await ensureObsidianAppForTool("obsidian_retrieve", config, options, appController, true);
      if (!appReady.ok) {
        return toolResponse(setupRequiredResponse(params, config, [...config.errors, ...appReady.errors, appReady.message], appReady.warnings));
      }
      const backend = options.backend ?? new ObsidianCliAdapter({ cliPath: config.cliPath, vaultTarget: config.vaultTarget, cwd: config.vaultRoot, timeoutMs: config.cliTimeoutMs, autoLaunch: false, launchWaitMs: config.launchWaitMs, obsidianAppPath: config.obsidianAppPath });
      const health = await backend.checkHealth({ allowAutoLaunch: false });
      if (!health.available) {
        const cliSetup = classifyObsidianCliSetupFailure(health);
        if (cliSetup) return toolResponse(setupRequiredResponse(params, config, [cliSetup.message], [], { cliSetup }));
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
    description: "Validate one explicit existing Markdown note or one explicit proposed Markdown content payload for objectively broken, risky, ambiguous, or agent-confusing Markdown. Read-only, workflow-neutral, bounded, and redacted. Supports target=existing_note with path, or target=proposed_content with content plus optional expectedPath, budget, and maxIssues. Existing-note validation may auto-open the configured Obsidian vault; validation never mutates, scans folders/vaults, rewrites links, automates UI, runs shell/network calls, creates templates, generates paths, or executes arbitrary commands.",
    promptSnippet: "Use obsidian_validate for read-only Markdown validation of one explicit note or explicit proposed content. It is advisory and workflow-neutral.",
    promptGuidelines: [
      "Use obsidian_validate when you need to check objectively broken, risky, ambiguous, or agent-confusing Markdown before suggesting edits or asking to commit content.",
      "Use target=existing_note with one explicit safe vault-relative Markdown path; obsidian_validate never infers paths from query text, search results, folders, tags, recents, aliases, or note titles.",
      "Use target=proposed_content with explicit non-empty Markdown content; proposed-content validation reads no vault files and does not require Obsidian setup.",
      "Optional expectedPath must be one explicit safe vault-relative Markdown path and is used only for path-aware advisory warnings such as title/path mismatch.",
      "Validation is advisory and workflow-neutral: missing frontmatter, tags, status/date/source fields, templates, PARA, Zettelkasten, daily-note structure, project-note structure, and other methodology choices are not errors.",
      "Suspicious absolute-looking, Windows absolute-looking, UNC-looking, traversal-looking, or .obsidian-looking strings inside Markdown content are warning-severity advisory issues; unsafe request path fields are refused before validation.",
      "Warning and info issues keep valid=true and must not block commits. valid=false is reserved for error-severity validation issues or request/setup failures where no valid content result was produced.",
      "obsidian_validate never creates, appends, edits, moves, trashes, restores, copies, deletes, creates folders, rewrites links, scans broadly, automates UI, runs shell/network calls, generates paths, uses templates, or executes arbitrary commands.",
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
      const config = effectiveAppConfig(await loadConfig(options), appState);
      if (!options.backend && config.errors.length > 0) {
        const result = await obsidianValidate(undefined, params, { defaultBudget: config.defaultRetrieveBudget as BudgetProfile | undefined, defaultMaxIssues: config.maxValidationIssues, setupErrors: config.errors });
        return toolResponse(result);
      }
      const appReady = await ensureObsidianAppForTool("obsidian_validate", config, options, appController, true);
      if (!appReady.ok) {
        return toolResponse(setupRequiredValidationResponse(params, [...config.errors, ...appReady.errors, appReady.message], appReady.warnings, preflight.path));
      }
      const backend = options.backend ?? new ObsidianCliAdapter({ cliPath: config.cliPath, vaultTarget: config.vaultTarget, cwd: config.vaultRoot, timeoutMs: config.cliTimeoutMs, autoLaunch: false, launchWaitMs: config.launchWaitMs, obsidianAppPath: config.obsidianAppPath });
      const health = await backend.checkHealth({ allowAutoLaunch: false });
      if (!health.available) {
        const cliSetup = classifyObsidianCliSetupFailure(health);
        if (cliSetup) return toolResponse(setupRequiredValidationResponse(params, [cliSetup.message], [], preflight.path, { setupMessage: cliSetup.message }));
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
    description: "Preview a bounded ordered sequence of supported non-destructive Obsidian operations without executing anything. Read-only. Supports planned retrieve.note, retrieve.relationships, validate existing/proposed content, write create/append/create_folder, edit structured operations, and manage move/trash/restore/copy. Vault-state plans may auto-open the configured Obsidian vault; planning never commits, stages, batches, transactionally applies, writes files, rewrites links, scans broadly, automates UI, runs shell/network calls, creates locks/reservations, or previews obsidian_destroy.",
    promptSnippet: "Use obsidian_plan to preview a sequence of explicit safe operations before asking for individual dry-runs. It never executes or commits.",
    promptGuidelines: [
      "Use obsidian_plan only for bounded preview of explicit non-destructive planned operations. It is read-only and cannot commit, batch-run, stage, or transactionally apply operations.",
      "Each planned operation must mirror a supported non-destructive public capability: retrieve note, retrieve.relationships, validate existing/proposed content, write create/append/create_folder, edit replace_section/insert_under_heading/update_frontmatter/remove_frontmatter/replace_exact_text, or manage move_note/trash_note/restore_note/copy_note. obsidian_destroy is deliberately not planned here; use obsidian_destroy dryRun for destructive previews.",
      "Planned retrieve.relationships entries require one explicit safe vault-relative Markdown path and follow relationship safety rules: no broad backlink scan, no recursive graph expansion, no full note dump, no link rewriting, and degraded signals when data is unavailable.",
      "dryRun:false in a planned operation is ignored and reported as a warning; obsidian_plan never passes dryRun:false to underlying tools.",
      "Plan preview may perform only targeted checks for explicit safe paths and virtual in-memory effects. It never scans folders or the vault broadly, expands wildcards, infers destinations, rewrites links, shells out, uses network, automates UI, or writes files.",
      "If valid=true, ask for individual existing-tool dry-runs before any commit. If valid=false, revise the plan; obsidian_plan cannot execute it.",
    ],
    parameters: ObsidianPlanParams,
    async execute(_toolCallId: string, params: ObsidianPlanRequest) {
      const config = effectiveAppConfig(await loadConfig(options), appState);
      if (planRequiresVaultPreflight(params)) {
        const appReady = await ensureObsidianAppForTool("obsidian_plan", config, options, appController, true);
        if (!appReady.ok) return toolResponse(setupRequiredPlanResponse(params, appReady));
      }
      const result = await obsidianPlan(params, { vaultRoot: config.vaultRoot });
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_write",
    label: "Obsidian Write",
    description: "Create or append Markdown notes, or create folders in Obsidian. The agent can call this naturally; before any mutation the extension shows the proposed change to the human and commits only after approval.",
    promptSnippet: "Use obsidian_write when the user wants to create/append a note or create a folder. Omit dryRun for normal requests; the extension handles human approval before committing.",
    promptGuidelines: [
      "Use obsidian_write when the user wants a note/folder changed in Obsidian. For create, provide path when obvious or title/folderHint so obsidian_write can infer a safe .md path.",
      "Use dryRun=true only when the user asks to preview, check, or plan without changing the vault; otherwise omit dryRun and let obsidian_write ask the human before committing. If the human has enabled Auto-write this session, obsidian_write still previews internally but skips future prompts for this session.",
      "obsidian_write appends Markdown exactly as supplied for append; include desired leading newlines, headings, or separators in content.",
      "obsidian_write keeps hard rails: no overwrite, delete, trash, restore, copy, rename, move, shell/network, broad scan, or arbitrary commands.",
    ],
    parameters: ObsidianWriteParams,
    async execute(_toolCallId: string, params: ObsidianWriteRequest, signal?: AbortSignal, _onUpdate?: unknown, ctx?: ToolExecutionContext) {
      const config = effectiveAppConfig(await loadConfig(options), appState);
      const result = await runWriteWithHumanApproval(params, config, ctx, approvalState, () => ensureObsidianAppForTool("obsidian_write", config, options, appController, true), signal);
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_edit",
    label: "Obsidian Edit",
    description: "Edit existing Markdown notes in Obsidian with structured operations. The agent can call this naturally; before any mutation the extension shows the proposed change to the human and commits only after approval.",
    promptSnippet: "Use obsidian_edit when the user wants to update an existing Obsidian note. Omit dryRun for normal requests; the extension handles human approval before committing.",
    promptGuidelines: [
      "Use obsidian_edit when the user wants to change an existing Markdown note with replace_section, insert_under_heading, update_frontmatter, remove_frontmatter, or replace_exact_text.",
      "Use dryRun=true only when the user asks to preview, check, or plan without changing the vault; otherwise omit dryRun and let obsidian_edit ask the human before committing. If the human has enabled Auto-write this session, obsidian_edit still previews internally but skips future prompts for this session.",
      "For replace_exact_text, provide oldText that appears exactly once and the desired newText. For section edits, provide the exact ATX heading such as ## Plan.",
      "obsidian_edit keeps hard rails: no create, full-note overwrite, delete, trash, restore, copy, rename/move, shell/network, regex/fuzzy edits, broad scan, or arbitrary commands."
    ],
    parameters: ObsidianEditParams,
    async execute(_toolCallId: string, params: ObsidianEditRequest, signal?: AbortSignal, _onUpdate?: unknown, ctx?: ToolExecutionContext) {
      const config = effectiveAppConfig(await loadConfig(options), appState);
      const result = await runEditWithHumanApproval(params, config, ctx, approvalState, () => ensureObsidianAppForTool("obsidian_edit", config, options, appController, true), signal);
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_manage",
    label: "Obsidian Manage",
    description: "Move/rename, recoverably trash, restore, or copy one Markdown note in Obsidian. The agent can call this naturally; before any mutation the extension shows the proposed change to the human and commits only after approval.",
    promptSnippet: "Use obsidian_manage when the user wants to move/rename, trash, restore, or copy one note. Omit dryRun for normal requests; the extension handles human approval before committing.",
    promptGuidelines: [
      "Use obsidian_manage for move_note, trash_note, restore_note, or copy_note on one Markdown note.",
      "Use dryRun=true only when the user asks to preview, check, or plan without changing the vault; otherwise omit dryRun and let obsidian_manage ask the human before committing. If the human has enabled Auto-write this session, obsidian_manage still previews internally but skips future prompts for this session.",
      "move_note/copy_note use fromPath and toPath; copy_note preserves bytes. trash_note uses path and optional trashFolder; restore_note uses trashPath and toPath.",
      "obsidian_manage keeps hard rails: no permanent delete, folders, bulk/wildcard/recursive actions, overwrites, link rewrites, shell/network, broad scan, or arbitrary commands.",
    ],
    parameters: ObsidianManageParams,
    async execute(_toolCallId: string, params: ObsidianManageRequest, signal?: AbortSignal, _onUpdate?: unknown, ctx?: ToolExecutionContext) {
      const config = effectiveAppConfig(await loadConfig(options), appState);
      const result = await runManageWithHumanApproval(params, config, ctx, approvalState, () => ensureObsidianAppForTool("obsidian_manage", config, options, appController, true), signal);
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_destroy",
    label: "Obsidian Destroy",
    description: "Permanently delete one note, permanently delete one explicit folder recursively, replace an entire existing note, or empty the default trash folder. The agent can call this naturally for explicitly destructive user requests; before any destructive mutation the extension shows the proposed destruction to the human and commits only after destructive approval.",
    promptSnippet: "Use obsidian_destroy only when the user explicitly asks for permanent deletion, recursive folder deletion, emptying trash, or full-note replacement. Auto-write does not apply; destructive approval is separate.",
    promptGuidelines: [
      "Use obsidian_destroy for delete_note, delete_folder, replace_note, or empty_trash only when the user clearly wants destructive behavior.",
      "Use dryRun=true only when the user asks to preview/check without changing the vault; otherwise omit dryRun and let obsidian_destroy ask the human for destructive approval before committing.",
      "delete_note and replace_note require one explicit safe vault-relative Markdown path. delete_folder requires one explicit safe vault-relative folder path. empty_trash uses the default trash folder.",
      "obsidian_destroy keeps hard rails: no vault root deletion, no .obsidian, hidden, wildcard, bulk, symlink, or special-file targets, no inferred targets, no shell/network, and no arbitrary commands.",
      "Auto-write this session never authorizes obsidian_destroy; destructive operations have separate Auto-destroy this session state.",
    ],
    parameters: ObsidianDestroyParams,
    async execute(_toolCallId: string, params: ObsidianDestroyRequest, signal?: AbortSignal, _onUpdate?: unknown, ctx?: ToolExecutionContext) {
      const config = effectiveAppConfig(await loadConfig(options), appState);
      const result = await runDestroyWithHumanApproval(params, config, ctx, approvalState, () => ensureObsidianAppForTool("obsidian_destroy", config, options, appController, true), signal);
      return toolResponse(result);
    },
  });

  const vaultCommandHandler = async (args: string, ctx: VaultCommandContext) => {
    if (await handleVaultPathCommand(args, options, ctx)) return;
    if (await handleAutoOpenCommand(args, appState, options, ctx)) return;
    const handled = handleAutoWriteCommand(args, approvalState, ctx) || handleAutoDestroyCommand(args, approvalState, ctx);
    if (handled) return;
    const normalizedArgs = normalizeCommandArgs(args);
    if (normalizedArgs === "help" || normalizedArgs === "-h" || normalizedArgs === "--help") {
      notifyVaultCommandUsage(ctx, "info");
      return;
    }
    if (normalizedArgs !== "" && normalizedArgs !== "status") {
      notifyUnknownVaultCommand(ctx);
      return;
    }
    const config = effectiveAppConfig(await loadConfig(options), appState);
    const status = statusFromConfig(config);
    const writeStatus = await writeStatusFromConfig(config);
    const editStatus = await editStatusFromConfig(config);
    const manageStatus = await manageStatusFromConfig(config);
    const ready = Boolean(status.vaultRoot) && writeStatus.writable && editStatus.status !== "unavailable" && manageStatus.status !== "unavailable";
    const lines = [
      `Obsidian Vault: ${ready ? "ready" : "setup needed"}`,
      `Vault: ${vaultSourceLabel(status.source)}`,
      `Mutations: ${approvalState.autoWriteForSession ? "auto-write this session" : "approval required"}`,
      `Destructive mutations: ${approvalState.autoDestroyForSession ? "auto-destroy this session" : "destructive approval required"}`,
      `Auto-open Obsidian: ${config.autoOpenObsidian ? "enabled" : "disabled"}`,
      `Auto-write this session: ${approvalState.autoWriteForSession ? "enabled" : "disabled"}`,
      `Auto-destroy this session: ${approvalState.autoDestroyForSession ? "enabled" : "disabled"}`,
      `Trash folder: ${config.defaultTrashFolder}`,
    ];
    if (!status.vaultRoot) lines.push("Tell me your Obsidian vault folder path and I can remember it.", "Or run: /obsidian-vault set-vault <path>");
    for (const warning of config.warnings) lines.push(`Warning: ${redactStatusPath(warning, config, [options.configPath].filter((value): value is string => Boolean(value)))}`);
    for (const error of [...status.errors, ...writeStatus.errors, ...editStatus.errors, ...manageStatus.errors]) lines.push(`Error: ${redactStatusPath(error, config, [options.configPath].filter((value): value is string => Boolean(value)))}`);
    ctx.ui.notify(lines.join("\n"), ready ? "info" : "warning");
  };

  pi.registerCommand("obsidian-vault", {
    description: "Show simple Obsidian vault status. Args: status, set-vault <path>, forget-vault, auto-open on|off|status, auto-write on|off|status, auto-destroy on|off|status",
    handler: vaultCommandHandler,
  });

  pi.registerCommand("obsidian", {
    description: "Alias for /obsidian-vault. Args: [vault] [status|set-vault <path>|forget-vault|auto-open on|off|status|auto-write on|off|status|auto-destroy on|off|status]",
    handler: async (args: string, ctx: VaultCommandContext) => {
      const forwardedArgs = obsidianAliasArgs(args);
      if (forwardedArgs === undefined) {
        notifyUnknownObsidianAliasCommand(ctx);
        return;
      }
      await vaultCommandHandler(forwardedArgs, ctx);
    },
  });
}

interface MutationApprovalState {
  autoWriteForSession: boolean;
  autoDestroyForSession: boolean;
}

interface ObsidianAppSessionState {
  autoOpenObsidian?: boolean | undefined;
}

type VaultCommandContext = { ui: { notify(message: string, level?: string): void } };

async function handleVaultPathCommand(args: string, options: RegisterObsidianVaultOptions, ctx: VaultCommandContext): Promise<boolean> {
  const trimmed = args.trim();
  const normalized = normalizeCommandArgs(args);
  if (normalized === "forget-vault" || normalized === "forget vault") {
    const result = await forgetRememberedVaultPath(options);
    ctx.ui.notify(result.message, result.status === "success" ? "info" : "warning");
    return true;
  }
  if (normalized === "set-vault" || normalized === "set vault") {
    const result = await setRememberedVaultPath("", options);
    ctx.ui.notify(`${result.message}\nUsage: /obsidian-vault set-vault <path>`, "warning");
    return true;
  }
  const setMatch = /^(?:set-vault|set vault)\s+(.+)$/i.exec(trimmed);
  if (setMatch) {
    const result = await setRememberedVaultPath(unquotePathArg(setMatch[1] ?? ""), options);
    ctx.ui.notify(result.message, result.status === "success" ? "info" : "warning");
    return true;
  }
  return false;
}

function unquotePathArg(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function vaultSourceLabel(source: VaultStatus["source"]): string {
  if (source === "auto") return "auto-detected";
  if (source === "remembered") return "remembered";
  if (source === "env") return "dev override";
  return "missing";
}

function normalizeCommandArgs(args: string): string {
  return args.trim().toLowerCase().replace(/\s+/g, " ");
}

function obsidianAliasArgs(args: string): string | undefined {
  const trimmed = args.trim();
  const normalized = normalizeCommandArgs(args);
  if (normalized === "") return "";
  if (normalized === "vault") return "";
  if (normalized.startsWith("vault ")) return trimmed.replace(/^vault\s+/i, "");
  return isVaultCommandPrefix(normalized) ? trimmed : undefined;
}

function isVaultCommandPrefix(normalized: string): boolean {
  const first = normalized.split(" ")[0] ?? "";
  return ["status", "help", "-h", "--help", "set-vault", "set", "forget-vault", "forget", "auto-open", "autoopen", "auto-write", "autowrite", "auto-destroy", "autodestroy"].includes(first);
}

function notifyUnknownVaultCommand(ctx: VaultCommandContext): void {
  ctx.ui.notify([
    "Unknown /obsidian-vault command.",
    "Use /obsidian-vault or /obsidian-vault status to show status.",
    "Other commands: set-vault <path>, forget-vault, auto-open on|off|status, auto-write on|off|status, auto-destroy on|off|status.",
  ].join("\n"), "warning");
}

function notifyVaultCommandUsage(ctx: VaultCommandContext, level: string = "info"): void {
  ctx.ui.notify([
    "Usage: /obsidian-vault [status]",
    "/obsidian-vault set-vault <path>",
    "/obsidian-vault forget-vault",
    "/obsidian-vault auto-open on|off|status",
    "/obsidian-vault auto-write on|off|status",
    "/obsidian-vault auto-destroy on|off|status",
  ].join("\n"), level);
}

function notifyUnknownObsidianAliasCommand(ctx: VaultCommandContext): void {
  ctx.ui.notify([
    "Unknown /obsidian command.",
    "Use /obsidian vault or /obsidian-vault to show vault status.",
    "Other commands: /obsidian vault set-vault <path>, /obsidian vault forget-vault, /obsidian vault auto-open on|off|status, /obsidian vault auto-write on|off|status, /obsidian vault auto-destroy on|off|status.",
  ].join("\n"), "warning");
}

async function handleAutoOpenCommand(args: string, state: ObsidianAppSessionState, options: RegisterObsidianVaultOptions, ctx: VaultCommandContext): Promise<boolean> {
  const normalized = normalizeCommandArgs(args);
  if (normalized === "auto-open on" || normalized === "autoopen on") {
    state.autoOpenObsidian = true;
    ctx.ui.notify("Auto-open Obsidian: enabled\nFuture vault-touching Obsidian tool calls will check whether Obsidian is running and auto-open it when possible.", "info");
    return true;
  }
  if (normalized === "auto-open off" || normalized === "autoopen off") {
    state.autoOpenObsidian = false;
    ctx.ui.notify("Auto-open Obsidian: disabled\nFuture vault-touching Obsidian tool calls will ask for Obsidian to be opened manually if it is not running.", "warning");
    return true;
  }
  if (normalized === "auto-open status" || normalized === "autoopen status") {
    const config = effectiveAppConfig(await loadConfig(options), state);
    ctx.ui.notify(`Auto-open Obsidian: ${config.autoOpenObsidian ? "enabled" : "disabled"}${state.autoOpenObsidian === undefined ? " (config default)" : " (session override)"}`, config.autoOpenObsidian ? "info" : "warning");
    return true;
  }
  return false;
}

function handleAutoWriteCommand(args: string, state: MutationApprovalState, ctx: VaultCommandContext): boolean {
  const normalized = normalizeCommandArgs(args);
  if (normalized === "") return false;
  if (normalized === "auto-write on" || normalized === "autowrite on") {
    state.autoWriteForSession = true;
    ctx.ui.notify("Auto-write this session: enabled\nFuture non-destructive Obsidian vault mutations will still run internal previews/safety checks, then commit without prompting until this Pi session resets or you run /obsidian-vault auto-write off. Destructive operations are not covered.", "warning");
    return true;
  }
  if (normalized === "auto-write off" || normalized === "autowrite off") {
    state.autoWriteForSession = false;
    ctx.ui.notify("Auto-write this session: disabled\nFuture non-destructive Obsidian vault mutations will ask for human approval before committing.", "info");
    return true;
  }
  if (normalized === "auto-write status" || normalized === "autowrite status") {
    ctx.ui.notify(`Auto-write this session: ${state.autoWriteForSession ? "enabled" : "disabled"}`, state.autoWriteForSession ? "warning" : "info");
    return true;
  }
  return false;
}

function handleAutoDestroyCommand(args: string, state: MutationApprovalState, ctx: VaultCommandContext): boolean {
  const normalized = normalizeCommandArgs(args);
  if (normalized === "auto-destroy on" || normalized === "autodestroy on") {
    state.autoDestroyForSession = true;
    ctx.ui.notify("Auto-destroy this session: enabled\nFuture obsidian_destroy calls will still run internal previews/safety checks, then commit without prompting until this Pi session resets or you run /obsidian-vault auto-destroy off.", "warning");
    return true;
  }
  if (normalized === "auto-destroy off" || normalized === "autodestroy off") {
    state.autoDestroyForSession = false;
    ctx.ui.notify("Auto-destroy this session: disabled\nFuture obsidian_destroy calls will ask for destructive approval before committing.", "info");
    return true;
  }
  if (normalized === "auto-destroy status" || normalized === "autodestroy status") {
    ctx.ui.notify(`Auto-destroy this session: ${state.autoDestroyForSession ? "enabled" : "disabled"}`, state.autoDestroyForSession ? "warning" : "info");
    return true;
  }
  return false;
}

type ToolExecutionContext = {
  ui?: {
    confirm?(title: string, message: string, options?: { timeout?: number | undefined }): boolean | Promise<boolean>;
    select?(title: string, options: string[]): string | undefined | Promise<string | undefined>;
  } | undefined;
};

type MutationApprovalDecision = "yes" | "no" | "auto_session";
type DestructionApprovalDecision = "yes" | "no" | "auto_session";

const APPROVAL_YES = "Yes";
const APPROVAL_NO = "No";
const APPROVAL_AUTO_SESSION = "Auto-write this session";
const DESTROY_APPROVAL_YES = "Yes, destroy";
const DESTROY_APPROVAL_AUTO_SESSION = "Auto-destroy this session";
const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const APP_PREFLIGHT_TIMEOUT_BUFFER_MS = 1_000;

type AppReadyCheck = () => Promise<ObsidianAppReadyResult>;

function effectiveAppConfig(config: VaultConfig, state: ObsidianAppSessionState): VaultConfig {
  return state.autoOpenObsidian === undefined ? config : { ...config, autoOpenObsidian: state.autoOpenObsidian };
}

async function ensureObsidianAppForTool(toolName: string, config: VaultConfig, options: RegisterObsidianVaultOptions, appController: ObsidianAppController, requiresVault: boolean): Promise<ObsidianAppReadyResult> {
  if (options.backend && !options.appController) {
    return { ok: true, status: "skipped", alreadyOpen: false, launched: false, retryable: false, message: "Obsidian app preflight skipped for injected test backend.", warnings: [], errors: [] };
  }
  const timeoutMs = Math.max(1_000, config.openTimeoutMs + config.launchCommandTimeoutMs + APP_PREFLIGHT_TIMEOUT_BUFFER_MS);
  return promiseWithTimeout(
    appController.ensureOpen({ config, toolName, requiresVault, env: options.env, platform: options.platform }),
    timeoutMs,
    () => ({ ok: false, status: "timeout", alreadyOpen: false, launched: false, retryable: true, message: "Obsidian app preflight timed out before it could complete.", warnings: [], errors: ["Open Obsidian manually, lower auto-open risk, or retry after the app finishes starting."] } as ObsidianAppReadyResult),
  ).catch(() => ({ ok: false, status: "launch_failed", alreadyOpen: false, launched: false, retryable: true, message: "Obsidian app preflight failed before it could complete.", warnings: [], errors: ["Open Obsidian manually, then retry."] } as ObsidianAppReadyResult));
}

async function runWriteWithHumanApproval(params: ObsidianWriteRequest, config: VaultConfig, ctx: ToolExecutionContext | undefined, state: MutationApprovalState, ensureReady: AppReadyCheck, signal?: AbortSignal): Promise<ObsidianWriteOutput> {
  const options = { vaultRoot: config.vaultRoot, maxPreviewChars: config.maxPreviewChars, writeDryRunValidationEnabled: config.writeDryRunValidationEnabled, appendDryRunValidationEnabled: config.appendDryRunValidationEnabled };
  if (params.dryRun === true) return obsidianWrite({ ...params, dryRun: true }, options);
  if (!state.autoWriteForSession && !hasHumanApprovalUi(ctx)) return obsidianWrite({ ...params, dryRun: true }, options);
  const preview = await obsidianWrite({ ...params, dryRun: true }, options);
  if (preview.status !== "preview") return preview;
  if (state.autoWriteForSession) {
    const commitReady = await ensureReady();
    if (!commitReady.ok) return appSetupWriteOutput(params, commitReady);
    return annotateAutoWriteCommit(await obsidianWrite({ ...params, dryRun: false }, options));
  }
  const decision = await requestMutationApproval(ctx, "Apply Obsidian write?", formatWriteConfirmation(preview), signal);
  if (decision === "no") return cancelledOutput(preview);
  const commitReady = await ensureReady();
  if (!commitReady.ok) return appSetupWriteOutput(params, commitReady);
  if (decision === "auto_session") state.autoWriteForSession = true;
  const committed = await obsidianWrite({ ...params, dryRun: false }, options);
  return decision === "auto_session" ? annotateAutoWriteEnabled(committed) : committed;
}

async function runEditWithHumanApproval(params: ObsidianEditRequest, config: VaultConfig, ctx: ToolExecutionContext | undefined, state: MutationApprovalState, ensureReady: AppReadyCheck, signal?: AbortSignal): Promise<ObsidianEditOutput> {
  const options = { vaultRoot: config.vaultRoot, maxPreviewChars: config.maxPreviewChars };
  if (params.dryRun === true) return obsidianEdit({ ...params, dryRun: true }, options);
  if (!state.autoWriteForSession && !hasHumanApprovalUi(ctx)) return obsidianEdit({ ...params, dryRun: true }, options);
  const preview = await obsidianEdit({ ...params, dryRun: true }, options);
  if (preview.status !== "preview") return preview;
  if (state.autoWriteForSession) {
    const commitReady = await ensureReady();
    if (!commitReady.ok) return appSetupEditOutput(params, commitReady);
    return annotateAutoWriteCommit(await obsidianEdit({ ...params, dryRun: false }, options));
  }
  const decision = await requestMutationApproval(ctx, "Apply Obsidian edit?", formatEditConfirmation(preview), signal);
  if (decision === "no") return cancelledOutput(preview);
  const commitReady = await ensureReady();
  if (!commitReady.ok) return appSetupEditOutput(params, commitReady);
  if (decision === "auto_session") state.autoWriteForSession = true;
  const committed = await obsidianEdit({ ...params, dryRun: false }, options);
  return decision === "auto_session" ? annotateAutoWriteEnabled(committed) : committed;
}

async function runManageWithHumanApproval(params: ObsidianManageRequest, config: VaultConfig, ctx: ToolExecutionContext | undefined, state: MutationApprovalState, ensureReady: AppReadyCheck, signal?: AbortSignal): Promise<ObsidianManageOutput> {
  const options = { vaultRoot: config.vaultRoot, defaultTrashFolder: config.defaultTrashFolder };
  if (params.dryRun === true) return obsidianManage({ ...params, dryRun: true }, options);
  if (!state.autoWriteForSession && !hasHumanApprovalUi(ctx)) return obsidianManage({ ...params, dryRun: true }, options);
  const preview = await obsidianManage({ ...params, dryRun: true }, options);
  if (preview.status !== "preview") return preview;
  if (state.autoWriteForSession) {
    const commitReady = await ensureReady();
    if (!commitReady.ok) return appSetupManageOutput(params, commitReady);
    return annotateAutoWriteCommit(await obsidianManage({ ...params, dryRun: false }, options));
  }
  const decision = await requestMutationApproval(ctx, "Apply Obsidian note management change?", formatManageConfirmation(preview), signal);
  if (decision === "no") return cancelledOutput(preview);
  const commitReady = await ensureReady();
  if (!commitReady.ok) return appSetupManageOutput(params, commitReady);
  if (decision === "auto_session") state.autoWriteForSession = true;
  const committed = await obsidianManage({ ...params, dryRun: false }, options);
  return decision === "auto_session" ? annotateAutoWriteEnabled(committed) : committed;
}

async function runDestroyWithHumanApproval(params: ObsidianDestroyRequest, config: VaultConfig, ctx: ToolExecutionContext | undefined, state: MutationApprovalState, ensureReady: AppReadyCheck, signal?: AbortSignal): Promise<ObsidianDestroyOutput> {
  const options = { vaultRoot: config.vaultRoot, maxPreviewChars: config.maxPreviewChars, defaultTrashFolder: config.defaultTrashFolder };
  if (params.dryRun === true) return obsidianDestroy({ ...params, dryRun: true }, options);
  if (!state.autoDestroyForSession && !hasHumanApprovalUi(ctx)) return obsidianDestroy({ ...params, dryRun: true }, options);
  const preview = await obsidianDestroy({ ...params, dryRun: true }, options);
  if (preview.status !== "preview") return preview;
  if (state.autoDestroyForSession) {
    const commitReady = await ensureReady();
    if (!commitReady.ok) return appSetupDestroyOutput(params, commitReady);
    return annotateAutoDestroyCommit(await obsidianDestroy({ ...params, dryRun: false }, options));
  }
  const decision = await requestDestructionApproval(ctx, "Permanently apply Obsidian destruction?", formatDestroyConfirmation(preview), signal);
  if (decision === "no") return cancelledDestroyOutput(preview);
  const commitReady = await ensureReady();
  if (!commitReady.ok) return appSetupDestroyOutput(params, commitReady);
  if (decision === "auto_session") state.autoDestroyForSession = true;
  const committed = await obsidianDestroy({ ...params, dryRun: false }, options);
  return decision === "auto_session" ? annotateAutoDestroyEnabled(committed) : committed;
}

function appSetupWriteOutput(params: ObsidianWriteRequest, ready: ObsidianAppReadyResult): ObsidianWriteOutput {
  return compactObject({
    tool: "obsidian_write" as const,
    status: "setup_required" as const,
    operation: params.operation?.trim() || undefined,
    dryRun: params.dryRun ?? true,
    committed: false,
    message: ready.message,
    error: { code: "VAULT_PATH_REQUIRED" as const, category: "setup" as const, message: "Obsidian must be open before obsidian_write can safely run.", recoverable: true },
    warnings: appReadyWarnings(ready),
    nextActions: [{ priority: 1, action: "configure_vault_path" as const, label: "Open Obsidian or enable auto-open before retrying." }],
  });
}

function appSetupEditOutput(params: ObsidianEditRequest, ready: ObsidianAppReadyResult): ObsidianEditOutput {
  return compactObject({
    tool: "obsidian_edit" as const,
    status: "setup_required" as const,
    operation: params.operation?.trim() || undefined,
    dryRun: params.dryRun ?? true,
    committed: false,
    message: ready.message,
    error: { code: "VAULT_PATH_REQUIRED" as const, category: "setup" as const, message: "Obsidian must be open before obsidian_edit can safely run.", recoverable: true },
    warnings: appReadyWarnings(ready),
    nextActions: [{ priority: 1, action: "configure_vault_path" as const, label: "Open Obsidian or enable auto-open before retrying." }],
  });
}

function appSetupManageOutput(params: ObsidianManageRequest, ready: ObsidianAppReadyResult): ObsidianManageOutput {
  return compactObject({
    tool: "obsidian_manage" as const,
    status: "setup_required" as const,
    operation: params.operation?.trim() || undefined,
    dryRun: params.dryRun ?? true,
    committed: false,
    message: ready.message,
    error: { code: "VAULT_PATH_REQUIRED" as const, category: "setup" as const, message: "Obsidian must be open before obsidian_manage can safely run.", recoverable: true },
    warnings: appReadyWarnings(ready),
    nextActions: [{ priority: 1, action: "configure_vault_path" as const, label: "Open Obsidian or enable auto-open before retrying." }],
  });
}

function appSetupDestroyOutput(params: ObsidianDestroyRequest, ready: ObsidianAppReadyResult): ObsidianDestroyOutput {
  return compactObject({
    tool: "obsidian_destroy" as const,
    status: "setup_required" as const,
    operation: params.operation?.trim() || undefined,
    dryRun: params.dryRun ?? true,
    committed: false,
    message: ready.message,
    error: { code: "VAULT_PATH_REQUIRED" as const, category: "setup" as const, message: "Obsidian must be open before obsidian_destroy can safely run.", recoverable: true },
    warnings: appReadyWarnings(ready),
    nextActions: [{ priority: 1, action: "configure_vault_path" as const, label: "Open Obsidian or enable auto-open before retrying." }],
  });
}

function appReadyWarnings(ready: ObsidianAppReadyResult): string[] {
  return [...ready.errors, ...ready.warnings, ready.message].filter(Boolean);
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return new Promise((resolve, reject) => {
    let settled = false;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, timeoutMs);
    promise.then((value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
  });
}

function approvalTimeout<T extends MutationApprovalDecision | DestructionApprovalDecision>(fallback: T): () => T {
  return () => fallback;
}

function abortPromise<T>(signal: AbortSignal | undefined, fallback: T): Promise<T> | undefined {
  if (!signal) return undefined;
  if (signal.aborted) return Promise.resolve(fallback);
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(fallback), { once: true }));
}

async function approvalResultWithTimeout<T>(value: T | Promise<T>, fallback: T, signal: AbortSignal | undefined): Promise<T> {
  const timed = promiseWithTimeout(Promise.resolve(value), APPROVAL_TIMEOUT_MS, () => fallback).catch(() => fallback);
  const aborted = abortPromise(signal, fallback);
  return aborted ? Promise.race([timed, aborted]) : timed;
}

function hasHumanApprovalUi(ctx: ToolExecutionContext | undefined): boolean {
  return typeof ctx?.ui?.select === "function" || typeof ctx?.ui?.confirm === "function";
}

async function requestMutationApproval(ctx: ToolExecutionContext | undefined, title: string, message: string, signal?: AbortSignal): Promise<MutationApprovalDecision> {
  if (typeof ctx?.ui?.select === "function") {
    const choice = await approvalResultWithTimeout(ctx.ui.select(`${title}\n\n${message}`, [APPROVAL_YES, APPROVAL_NO, APPROVAL_AUTO_SESSION]), APPROVAL_NO, signal);
    if (choice === APPROVAL_YES) return "yes";
    if (choice === APPROVAL_AUTO_SESSION) return "auto_session";
    return "no";
  }
  if (typeof ctx?.ui?.confirm === "function") return Boolean(await approvalResultWithTimeout(ctx.ui.confirm(title, message, { timeout: APPROVAL_TIMEOUT_MS }), false, signal)) ? "yes" : "no";
  return "yes";
}

async function requestDestructionApproval(ctx: ToolExecutionContext | undefined, title: string, message: string, signal?: AbortSignal): Promise<DestructionApprovalDecision> {
  if (typeof ctx?.ui?.select === "function") {
    const choice = await approvalResultWithTimeout(ctx.ui.select(`${title}\n\n${message}`, [DESTROY_APPROVAL_YES, APPROVAL_NO, DESTROY_APPROVAL_AUTO_SESSION]), APPROVAL_NO, signal);
    if (choice === DESTROY_APPROVAL_YES) return "yes";
    if (choice === DESTROY_APPROVAL_AUTO_SESSION) return "auto_session";
    return "no";
  }
  if (typeof ctx?.ui?.confirm === "function") return Boolean(await approvalResultWithTimeout(ctx.ui.confirm(title, message, { timeout: APPROVAL_TIMEOUT_MS }), false, signal)) ? "yes" : "no";
  return "yes";
}

function annotateAutoWriteEnabled<T extends { warnings: string[] }>(output: T): T {
  return { ...output, warnings: [...output.warnings, "Auto-write enabled for this Pi session; future Obsidian mutations will skip approval prompts until session reset or /obsidian-vault auto-write off."] };
}

function annotateAutoWriteCommit<T extends { warnings: string[] }>(output: T): T {
  return { ...output, warnings: [...output.warnings, "Auto-write is enabled for this Pi session; approval prompt was skipped after internal preview/safety checks."] };
}

function annotateAutoDestroyEnabled<T extends { warnings: string[] }>(output: T): T {
  return { ...output, warnings: [...output.warnings, "Auto-destroy enabled for this Pi session; future obsidian_destroy calls will skip destructive approval prompts until session reset or /obsidian-vault auto-destroy off."] };
}

function annotateAutoDestroyCommit<T extends { warnings: string[] }>(output: T): T {
  return { ...output, warnings: [...output.warnings, "Auto-destroy is enabled for this Pi session; destructive approval prompt was skipped after internal preview/safety checks."] };
}

function cancelledOutput<T extends { message: string; committed: boolean; warnings: string[]; nextActions: unknown[] }>(preview: T): T {
  return {
    ...preview,
    committed: false,
    message: "Cancelled by user; no Obsidian vault changes were made.",
    warnings: [...preview.warnings, "Human approval was denied; no vault changes were made."],
    nextActions: [{ priority: 1, action: "stop", label: "No changes were made." }],
  } as T;
}

function cancelledDestroyOutput<T extends { message: string; committed: boolean; warnings: string[]; nextActions: unknown[] }>(preview: T): T {
  return {
    ...preview,
    committed: false,
    message: "Cancelled by user; no destructive Obsidian vault changes were made.",
    warnings: [...preview.warnings, "Destructive approval was denied; no vault changes were made."],
    nextActions: [{ priority: 1, action: "stop", label: "No destructive changes were made." }],
  } as T;
}

function formatWriteConfirmation(output: ObsidianWriteOutput): string {
  const lines = [
    `${output.operation ?? "write"}: ${output.path ?? output.preview?.path ?? "unknown path"}`,
    "",
    "Proposed change:",
    jsonBlock(output.preview ?? output.target ?? {}),
  ];
  if (output.preview?.contentPreview) lines.push("", "Markdown content:", fence(output.preview.contentPreview));
  if (output.preview?.previewTruncated) lines.push("", "Warning: preview is truncated by maxPreviewChars.");
  return lines.join("\n");
}

function formatEditConfirmation(output: ObsidianEditOutput): string {
  const lines = [
    `${output.operation ?? "edit"}: ${output.path ?? output.preview?.path ?? "unknown path"}`,
    "",
    "Proposed edit:",
    jsonBlock(output.preview ?? output.target ?? {}),
  ];
  if (output.preview?.beforePreview !== undefined) lines.push("", "Before:", fence(output.preview.beforePreview));
  if (output.preview?.afterPreview !== undefined) lines.push("", "After:", fence(output.preview.afterPreview));
  if (output.preview?.insertedPreview !== undefined) lines.push("", "Inserted:", fence(output.preview.insertedPreview));
  if (output.preview?.previewTruncated) lines.push("", "Warning: preview is truncated by maxPreviewChars.");
  return lines.join("\n");
}

function formatManageConfirmation(output: ObsidianManageOutput): string {
  return [
    `${output.operation ?? "manage"}: ${output.fromPath ?? output.path ?? output.trashPath ?? "unknown source"}${output.toPath ? ` → ${output.toPath}` : ""}`,
    "",
    "Proposed change:",
    jsonBlock(output.preview ?? output.target ?? {}),
    output.linkImpact?.linkImpactWarning ? `\n${output.linkImpact.linkImpactWarning}` : "",
  ].filter(Boolean).join("\n");
}

function formatDestroyConfirmation(output: ObsidianDestroyOutput): string {
  const lines = [
    `${output.operation ?? "destroy"}: ${output.path ?? output.trashFolder ?? "default trash"}`,
    "",
    "Permanent destructive change:",
    jsonBlock(output.preview ?? output.target ?? {}),
  ];
  if (output.preview?.beforePreview !== undefined) lines.push("", "Before:", fence(output.preview.beforePreview));
  if (output.preview?.afterPreview !== undefined) lines.push("", "After:", fence(output.preview.afterPreview));
  if (output.preview?.previewTruncated) lines.push("", "Warning: preview is truncated by maxPreviewChars.");
  lines.push("", "This is destructive and may not be recoverable from inside Obsidian.");
  return lines.join("\n");
}

function jsonBlock(value: unknown): string {
  return fence(JSON.stringify(value, null, 2), "json");
}

function fence(value: string, language = "markdown"): string {
  return `\`\`\`${language}\n${value}\n\`\`\``;
}

function boundedSetupDiagnostics(messages: string[], config: VaultConfig | undefined): string[] {
  const redacted = messages
    .map((message) => redactStatusPath(message, config))
    .map((message) => message.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((message) => message.length > 500 ? `${message.slice(0, 497)}...` : message);
  return [...new Set(redacted)].slice(0, 8);
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

function planRequiresVaultPreflight(params: ObsidianPlanRequest): boolean {
  if (!Array.isArray(params.operations)) return false;
  for (const op of params.operations) {
    if (!op || typeof op !== "object" || Array.isArray(op)) continue;
    const record = op as Record<string, unknown>;
    const tool = planToolName(record.tool) ?? planToolName(record.category);
    const operation = typeof record.operation === "string" ? record.operation.trim().toLowerCase() : "";
    if (tool === "validate" && operation === "proposed_content") continue;
    if (tool === "retrieve" && ["note", "relationships"].includes(operation)) return true;
    if (tool === "validate" && operation === "existing_note") return true;
    if (tool === "write" && ["create", "append", "create_folder"].includes(operation)) return true;
    if (tool === "edit" && ["replace_section", "insert_under_heading", "update_frontmatter", "remove_frontmatter", "replace_exact_text"].includes(operation)) return true;
    if (tool === "manage" && ["move_note", "trash_note", "restore_note", "copy_note"].includes(operation)) return true;
  }
  return false;
}

function planToolName(value: unknown): "retrieve" | "validate" | "write" | "edit" | "manage" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/^obsidian_/, "");
  if (["retrieve", "validate", "write", "edit", "manage"].includes(normalized)) return normalized as "retrieve" | "validate" | "write" | "edit" | "manage";
  return undefined;
}

function setupRequiredPlanResponse(params: ObsidianPlanRequest, ready: ObsidianAppReadyResult): ObsidianPlanOutput {
  const operationCount = Array.isArray(params.operations) ? params.operations.length : 0;
  const warnings = appReadyWarnings(ready);
  return {
    tool: "obsidian_plan",
    status: "setup_required",
    operationCount,
    valid: false,
    issues: [{ code: "CHECK_UNAVAILABLE", severity: "error", message: "Obsidian must be open before obsidian_plan can inspect existing vault state." }],
    plannedEffects: emptyPlannedEffects(),
    conflicts: [],
    warnings,
    degradedSignals: ["app_preflight"],
    summary: { previewOnly: true, wouldMutateIfExecutedIndividually: false, errorCount: 1, warningCount: warnings.length, infoCount: 0, conflictCount: 0, operationCount },
    nextActions: [{ priority: 1, action: "configure_vault", label: "Open Obsidian or enable auto-open before retrying the plan preview." }],
  };
}

function emptyPlannedEffects(): ObsidianPlanOutput["plannedEffects"] {
  return { notesCreated: [], notesAppended: [], notesEdited: [], foldersCreated: [], notesMoved: [], notesTrashed: [], notesRestored: [], notesCopied: [], notesReadOrValidated: [], affectedPaths: [] };
}

function setupRequiredResponse(params: RetrievalRequest, config: VaultConfig | undefined, errors: string[], extraWarnings: string[] = [], options: { cliSetup?: ObsidianCliSetupClassification | undefined } = {}): ObsidianRetrieveOutput {
  const profile = params.budget ?? config?.defaultBudget ?? "standard";
  const budget = budgetForProfile(profile, config?.budgetChars);
  const warnings = options.cliSetup ? [options.cliSetup.message] : boundedSetupDiagnostics([...errors, ...extraWarnings], config);
  const guidance: AgentGuidance = {
    resultState: "no_match",
    bestMatch: null,
    confidence: {
      level: "none",
      ambiguous: false,
      rationale: options.cliSetup ? "Obsidian retrieval is not available until the Obsidian CLI is enabled and registered on PATH." : "Obsidian retrieval is not available until setup or app launch succeeds.",
    },
    contextRecommendation: {
      recommended: false,
      reason: options.cliSetup ? "Do not request context until the Obsidian CLI setup is complete." : "Do not request context until Obsidian is configured and reachable.",
      selected: [],
      mode: "none",
      answerScope: "clarify_first",
    },
    alternatives: [],
    nextActions: [
      {
        priority: 1,
        action: options.cliSetup ? "configure_obsidian_cli" : "stop",
        label: options.cliSetup ? options.cliSetup.instructions : "Tell me your Obsidian vault folder path, or open Obsidian once so I can auto-detect it, then retry."
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
