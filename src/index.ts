import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import path from "node:path";
import { Type } from "typebox";
import { editStatusFromConfig, loadConfig, manageStatusFromConfig, statusFromConfig, writeStatusFromConfig, type LoadConfigOptions, type VaultConfig } from "./config.js";
import { budgetForProfile } from "./context-packer.js";
import { ObsidianCliAdapter } from "./obsidian-cli.js";
import { obsidianRetrieve } from "./retrieval-engine.js";
import { obsidianEdit } from "./edit-engine.js";
import { obsidianManage } from "./manage-engine.js";
import { obsidianWrite } from "./write-engine.js";
import type { AgentGuidance, BudgetProfile, ObsidianCliBackend, ObsidianRetrieveOutput, ResolvedRetrievalMode, RetrievalRequest } from "./retrieval-types.js";
import type { ObsidianEditRequest } from "./edit-types.js";
import type { ObsidianManageRequest } from "./manage-types.js";
import type { ObsidianWriteRequest } from "./write-types.js";

export * from "./retrieval-types.js";
export { loadConfig } from "./config.js";
export { ObsidianCliAdapter } from "./obsidian-cli.js";
export { obsidianRetrieve } from "./retrieval-engine.js";
export { obsidianEdit } from "./edit-engine.js";
export { obsidianManage } from "./manage-engine.js";
export { obsidianWrite } from "./write-engine.js";
export * from "./edit-types.js";
export * from "./manage-types.js";
export * from "./write-types.js";

export interface RegisterObsidianVaultOptions extends LoadConfigOptions {
  backend?: ObsidianCliBackend | undefined;
}

export const OBSIDIAN_RETRIEVE_BUDGETS = ["tiny", "standard", "expanded"] as const;
export const OBSIDIAN_RETRIEVE_MODES = ["auto", "search", "context", "graph", "project"] as const;

const Budget = StringEnum(OBSIDIAN_RETRIEVE_BUDGETS, {
  description: "Response budget profile. Valid values: tiny, standard, expanded.",
});
const Mode = StringEnum(OBSIDIAN_RETRIEVE_MODES, {
  description: "Retrieval mode. Valid values: auto, search, context, graph, project.",
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
  query: Type.Optional(Type.String({ description: "Natural-language query, title, alias, tag, property, or project/topic phrase." })),
  mode: Type.Optional(Mode),
  selected: Type.Optional(Type.Array(SelectedRefParam, { description: "Only for context mode: exact selectedRef objects returned by prior obsidian_retrieve candidates or agentGuidance." })),
  scope: Type.Optional(ScopeParam),
  budget: Type.Optional(Budget),
  maxCandidates: Type.Optional(Type.Integer({ minimum: 1, maximum: 12, description: "Maximum ranked candidates to return (1-12, also capped by budget)." })),
  explain: Type.Optional(Type.Boolean({ description: "When true, preserve concise ranking rationale where budget allows." })),
}, {
  additionalProperties: false,
  description: "obsidian_retrieve arguments. Supported top-level fields only: query, mode, selected, scope, budget, maxCandidates, explain. Valid modes: auto, search, context, graph, project. Valid budgets: tiny, standard, expanded. Examples: search {\"query\":\"integrated gradients\",\"mode\":\"search\",\"budget\":\"standard\"}; graph {\"query\":\"Integrated Gradients connections\",\"mode\":\"graph\",\"budget\":\"expanded\"}; context {\"mode\":\"context\",\"query\":\"implementation details\",\"selected\":[{\"path\":\"Research/Integrated Gradients/index.md\",\"title\":\"Integrated Gradients\"}],\"budget\":\"standard\"}.",
});

const ObsidianWriteParams = Type.Object({
  operation: Type.Optional(Type.String({ description: "Write operation. Supported semantic values are create, append, and create_folder; forbidden operations return safety_refusal." })),
  path: Type.Optional(Type.String({ description: "Explicit vault-relative Markdown path for create/append or folder path for create_folder. obsidian_write never infers destinations from query/topic text." })),
  content: Type.Optional(Type.String({ description: "Markdown content to create or append exactly as supplied. Must be non-empty for create/append and must be omitted for create_folder." })),
  dryRun: Type.Optional(Type.Boolean({ description: "When true or omitted, validate and preview without changing notes or folders. Set false only after explicit confirmation." })),
}, {
  additionalProperties: false,
  description: "obsidian_write arguments. Supported top-level fields only: operation, path, content, dryRun. Supported operations: create, append, and create_folder. dryRun defaults to true. Markdown note operations require explicit safe vault-relative .md paths and non-empty content; create_folder requires an explicit safe vault-relative folder path and rejects content with CONTENT_NOT_ALLOWED. No overwrite, delete, rename, move, open UI, shell, network, scan, discovery, or arbitrary CLI behavior is supported.",
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
}, {
  additionalProperties: false,
  description: "obsidian_edit arguments. Supported top-level fields only: operation, path, heading, content, property, value, oldText, newText, dryRun. Supported operations: replace_section, insert_under_heading, update_frontmatter, remove_frontmatter, replace_exact_text. dryRun defaults to true. Path must be an explicit safe vault-relative Markdown path to an existing note. No create, full-note overwrite, delete, rename, move, open UI, shell, network, regex, fuzzy, scan, or arbitrary CLI behavior is supported.",
});

const ObsidianManageParams = Type.Object({
  operation: Type.Optional(Type.String({ description: "Manage operation. Supported semantic value is exactly move_note; forbidden operations return safety_refusal." })),
  fromPath: Type.Optional(Type.String({ description: "Explicit safe vault-relative Markdown source note path. obsidian_manage never infers sources from search, title, alias, or folder scans." })),
  toPath: Type.Optional(Type.String({ description: "Explicit safe vault-relative Markdown destination note path. Destination must not exist and its parent folder must already exist." })),
  dryRun: Type.Optional(Type.Boolean({ description: "When true or omitted, validate and preview without moving anything. Set false only after explicit confirmation." })),
}, {
  additionalProperties: false,
  description: "obsidian_manage arguments. Supported top-level fields only: operation, fromPath, toPath, dryRun. Supported operation is exactly move_note. move_note moves or renames exactly one existing Markdown note from an explicit safe vault-relative fromPath to an explicit safe vault-relative toPath. dryRun defaults to true. Source must exist, destination must not exist, and destination parent folder must already exist. No folder moves, overwrite, delete, copy, link rewrite, open UI, shell, network, scan, discovery, or arbitrary CLI behavior is supported.",
});

export function registerObsidianVault(pi: Pick<ExtensionAPI, "registerTool" | "registerCommand">, options: RegisterObsidianVaultOptions = {}): void {
  pi.registerTool({
    name: "obsidian_retrieve",
    label: "Obsidian Retrieve",
    description: "Retrieve ranked Obsidian note candidates, agentGuidance, and bounded selected-note context through the official Obsidian CLI. Read-only and candidate-first. Args: query?: string; mode?: auto|search|context|graph|project; selected?: [{path,title?}]; scope?: {folder?,tags?,properties?,recent?}; budget?: tiny|standard|expanded; maxCandidates?: 1-12; explain?: boolean. Valid examples: search {\"query\":\"integrated gradients\",\"mode\":\"search\",\"budget\":\"standard\"}; graph {\"query\":\"Integrated Gradients connections\",\"mode\":\"graph\",\"budget\":\"expanded\"}; context {\"mode\":\"context\",\"query\":\"implementation details\",\"selected\":[{\"path\":\"Research/Integrated Gradients/index.md\",\"title\":\"Integrated Gradients\"}],\"budget\":\"standard\"}.",
    promptSnippet: "Use obsidian_retrieve first for Obsidian questions. Valid budgets: tiny, standard, expanded. For context, pass mode=context with exact selectedRef paths returned by agentGuidance.",
    promptGuidelines: [
      "Use obsidian_retrieve as the only Obsidian-facing retrieval tool; supported top-level request fields are query, mode, selected, scope, budget, maxCandidates, and explain.",
      "Use obsidian_retrieve mode=search like {\"query\":\"integrated gradients\",\"mode\":\"search\",\"budget\":\"standard\"} for candidate discovery.",
      "Use obsidian_retrieve mode=graph like {\"query\":\"Integrated Gradients connections\",\"mode\":\"graph\",\"budget\":\"expanded\"} for bounded relationship summaries.",
      "Use obsidian_retrieve mode=context like {\"mode\":\"context\",\"query\":\"implementation details\",\"selected\":[{\"path\":\"Research/Integrated Gradients/index.md\",\"title\":\"Integrated Gradients\"}],\"budget\":\"standard\"} only for exact selectedRef paths returned by prior obsidian_retrieve output.",
      "Start with candidate discovery; do not ask for broad note, folder, or vault dumps.",
      "Read agentGuidance.resultState, bestMatch, confidence, contextRecommendation, and nextActions before deciding whether to answer or call context mode.",
      "Use obsidian_retrieve mode=project with scope.folder for bounded project summaries; outputs still remain candidate-first.",
      "obsidian_retrieve is read-only. It does not open Obsidian and does not write, append, rename, move, or delete notes.",
    ],
    parameters: ObsidianRetrieveParams,
    async execute(_toolCallId: string, params: RetrievalRequest) {
      const config = options.backend ? undefined : await loadConfig(options);
      if (config && config.errors.length > 0) {
        return toolResponse(setupRequiredResponse(params, config, config.errors));
      }
      const backend = options.backend ?? new ObsidianCliAdapter({ cliPath: config?.cliPath, vaultTarget: config?.vaultTarget, cwd: config?.vaultRoot, timeoutMs: config?.cliTimeoutMs, autoLaunch: config?.autoLaunch, launchWaitMs: config?.launchWaitMs, obsidianAppPath: config?.obsidianAppPath });
      const health = await backend.checkHealth({ allowAutoLaunch: config?.autoLaunch ?? false });
      if (!health.available) {
        const errors = [...(config?.errors ?? []), ...health.errors, "Obsidian retrieval is unavailable. Open Obsidian manually, then retry."];
        return toolResponse(setupRequiredResponse(params, config, errors, health.warnings));
      }
      const result = await obsidianRetrieve(backend, params, { defaultBudget: config?.defaultBudget as BudgetProfile | undefined, budgetChars: config?.budgetChars });
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_write",
    label: "Obsidian Write",
    description: "Create or append Markdown notes, or create folders, in Obsidian using explicit safe vault-relative paths. Separate from obsidian_retrieve and obsidian_edit. Supports operation=create, operation=append, or operation=create_folder, plus path, content for create/append only, and dryRun. dryRun defaults to true. Never overwrites, deletes, renames, moves, opens the UI, runs shell/network calls, scans the vault, discovers filesystem structure, or executes arbitrary CLI commands.",
    promptSnippet: "Use obsidian_write only for explicit safe Markdown create/append or folder create_folder requests. Prefer dryRun=true previews before committing with dryRun=false.",
    promptGuidelines: [
      "Use obsidian_write only when the user wants to create a new Markdown note, append to an existing Markdown note, or create an explicit safe vault-relative folder.",
      "Use obsidian_write with dryRun=true or omitted to preview writes/folder creation; set dryRun=false only after explicit user confirmation or clear instruction to commit.",
      "For Markdown notes, obsidian_write requires operation=create or operation=append, an explicit safe vault-relative .md path, and non-empty content; obsidian_write never infers paths from vague topic instructions.",
      "For folders, obsidian_write requires operation=create_folder and an explicit safe vault-relative folder path; omit content, because supplied content is rejected with CONTENT_NOT_ALLOWED and no file is created or modified.",
      "obsidian_write appends Markdown exactly as supplied for append; include desired leading newlines, headings, or separators in content.",
      "obsidian_write refuses overwrite, delete, rename, move, open UI, shell, network, scan, discovery, and arbitrary CLI requests with safety_refusal.",
      "Use obsidian_retrieve for reading/searching Obsidian; obsidian_retrieve remains read-only. Use obsidian_edit only for controlled edits to existing Markdown notes.",
    ],
    parameters: ObsidianWriteParams,
    async execute(_toolCallId: string, params: ObsidianWriteRequest) {
      const config = await loadConfig(options);
      const result = await obsidianWrite(params, { vaultRoot: config.vaultRoot });
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_edit",
    label: "Obsidian Edit",
    description: "Safely edit existing Markdown notes in Obsidian using explicit structured operations. Separate from obsidian_retrieve and obsidian_write. Supports replace_section, insert_under_heading, update_frontmatter, remove_frontmatter, and replace_exact_text. dryRun defaults to true. Requires an explicit safe vault-relative Markdown path to an existing note. Never creates notes, overwrites full notes, deletes, renames, moves, opens the UI, runs shell/network calls, scans the vault, or executes arbitrary CLI commands.",
    promptSnippet: "Use obsidian_edit only for explicit safe structured edits to existing Markdown notes. Prefer dryRun=true previews before committing with dryRun=false.",
    promptGuidelines: [
      "Use obsidian_edit only when the user wants to edit an existing Markdown note at an explicit safe vault-relative .md path.",
      "Use obsidian_edit with dryRun=true or omitted to preview structured edits; set dryRun=false only after explicit user confirmation or clear instruction to commit.",
      "obsidian_edit requires operation, path, and operation-specific fields: heading/content for replace_section or insert_under_heading; property/value for update_frontmatter; property for remove_frontmatter; oldText/newText for replace_exact_text.",
      "For replace_exact_text, oldText must match exactly once with no regex, fuzzy, semantic, normalized, or inferred matching; duplicate or missing oldText fails without mutation.",
      "Section headings must be exact ATX Markdown headings such as ## Plan; duplicate matching headings return ambiguity and must not be resolved automatically.",
      "Frontmatter edits affect only top-of-file YAML frontmatter; update_frontmatter may create frontmatter, remove_frontmatter requires an existing property.",
      "obsidian_edit refuses create, full-note overwrite, delete, rename, move, open UI, shell, network, regex, fuzzy, scan, and arbitrary CLI requests with safety_refusal.",
      "Use obsidian_write only for create/append/create_folder; use obsidian_manage only for move_note; use obsidian_retrieve only for reading/searching. Keep retrieval read-only and keep folder creation/move management out of obsidian_edit."
    ],
    parameters: ObsidianEditParams,
    async execute(_toolCallId: string, params: ObsidianEditRequest) {
      const config = await loadConfig(options);
      const result = await obsidianEdit(params, { vaultRoot: config.vaultRoot });
      return toolResponse(result);
    },
  });

  pi.registerTool({
    name: "obsidian_manage",
    label: "Obsidian Manage",
    description: "Safely move or rename exactly one existing Markdown note in Obsidian using explicit safe vault-relative paths. Separate from obsidian_retrieve, obsidian_write, and obsidian_edit. Supports only operation=move_note, fromPath, toPath, and dryRun. dryRun defaults to true. Source note must exist, destination note must not exist, and destination parent folder must already exist. Never moves folders, overwrites, deletes, copies, rewrites links, opens the UI, runs shell/network calls, scans the vault, discovers filesystem structure, or executes arbitrary CLI commands.",
    promptSnippet: "Use obsidian_manage only for explicit safe single-note move/rename requests with operation=move_note. Prefer dryRun=true previews before committing with dryRun=false.",
    promptGuidelines: [
      "Use obsidian_manage only when the user wants to move or rename exactly one existing Markdown note from an explicit safe vault-relative fromPath to an explicit safe vault-relative toPath.",
      "obsidian_manage supports only operation=move_note. Do not use it for folder moves, multi-note moves, delete, copy, overwrite, link rewriting, UI open, shell, network, scan, discovery, or arbitrary commands.",
      "Use obsidian_manage with dryRun=true or omitted to preview; set dryRun=false only after explicit user confirmation or clear instruction to commit.",
      "move_note requires fromPath and toPath to be different safe vault-relative .md paths. The source note must already exist, the destination must not exist, and the destination parent folder must already exist.",
      "If the destination parent folder is missing, obsidian_manage returns status=not_found with error.code=PARENT_MISSING; create the folder separately with obsidian_write create_folder only if the user requests it.",
      "obsidian_manage responses expose only vault-relative paths and never expose the vault root, absolute source/destination paths, absolute CLI paths, or lock keys.",
      "Keep obsidian_retrieve read-only, obsidian_write limited to create/append/create_folder, and obsidian_edit limited to controlled content edits of existing Markdown notes.",
    ],
    parameters: ObsidianManageParams,
    async execute(_toolCallId: string, params: ObsidianManageRequest) {
      const config = await loadConfig(options);
      const result = await obsidianManage(params, { vaultRoot: config.vaultRoot });
      return toolResponse(result);
    },
  });

  pi.registerCommand("obsidian-vault", {
    description: "Show configured Obsidian CLI retrieval, write, structured edit, and note management status",
    handler: async (_args: string, ctx: { ui: { notify(message: string, level?: string): void } }) => {
      const backend = await backendFromOptions(options);
      const config = await loadConfig(options);
      const status = config ? statusFromConfig(config) : undefined;
      const writeStatus = config ? await writeStatusFromConfig(config) : undefined;
      const editStatus = config ? await editStatusFromConfig(config) : undefined;
      const manageStatus = config ? await manageStatusFromConfig(config) : undefined;
      const health = await backend.checkHealth({ allowAutoLaunch: false });
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
      const extraSensitivePaths = [health.cliPath];
      for (const error of [...(status?.errors ?? []), ...health.errors, ...(writeStatus?.errors ?? []), ...(editStatus?.errors ?? []), ...(manageStatus?.errors ?? [])]) lines.push(`Error: ${redactStatusPath(error, config, extraSensitivePaths)}`);
      for (const warning of [...health.warnings, ...(writeStatus?.warnings ?? []), ...(editStatus?.warnings ?? []), ...(manageStatus?.warnings ?? [])]) lines.push(`Warning: ${redactStatusPath(warning, config, extraSensitivePaths)}`);
      ctx.ui.notify(lines.join("\n"), health.available && (writeStatus?.writable ?? true) && (editStatus?.status !== "degraded") && (manageStatus?.status !== "degraded") ? "info" : "warning");
    },
  });
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
  if (params.mode === "context" || params.mode === "graph" || params.mode === "project" || params.mode === "search") return params.mode;
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
