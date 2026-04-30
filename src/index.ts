import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, statusFromConfig, type LoadConfigOptions, type VaultConfig } from "./config.js";
import { budgetForProfile } from "./context-packer.js";
import { ObsidianCliAdapter } from "./obsidian-cli.js";
import { obsidianRetrieve } from "./retrieval-engine.js";
import type { AgentGuidance, BudgetProfile, ObsidianCliBackend, ObsidianRetrieveOutput, ResolvedRetrievalMode, RetrievalRequest } from "./retrieval-types.js";

export * from "./retrieval-types.js";
export { loadConfig } from "./config.js";
export { ObsidianCliAdapter } from "./obsidian-cli.js";
export { obsidianRetrieve } from "./retrieval-engine.js";

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

  pi.registerCommand("obsidian-vault", {
    description: "Show configured Obsidian CLI retrieval status",
    handler: async (_args: string, ctx: { ui: { notify(message: string, level?: string): void } }) => {
      const backend = await backendFromOptions(options);
      const config = options.backend ? undefined : await loadConfig(options);
      const status = config ? statusFromConfig(config) : undefined;
      const health = await backend.checkHealth({ allowAutoLaunch: false });
      const lines = [
        `Obsidian Vault: ${health.available ? "CLI available" : "CLI unavailable"}`,
        status ? `Source: ${status.source}` : "Source: injected backend",
        `CLI: ${health.cliPath}`,
      ];
      if (status?.vaultRoot) lines.push(`Vault path: ${status.vaultRoot}`);
      if (status?.vaultTarget || health.vaultTarget) lines.push(`Vault target: ${status?.vaultTarget ?? health.vaultTarget}`);
      for (const error of [...(status?.errors ?? []), ...health.errors]) lines.push(`Error: ${error}`);
      for (const warning of health.warnings) lines.push(`Warning: ${warning}`);
      ctx.ui.notify(lines.join("\n"), health.available ? "info" : "warning");
    },
  });
}

async function backendFromOptions(options: RegisterObsidianVaultOptions): Promise<ObsidianCliBackend> {
  if (options.backend) return options.backend;
  const config = await loadConfig(options);
  return new ObsidianCliAdapter({ cliPath: config.cliPath, vaultTarget: config.vaultTarget, cwd: config.vaultRoot, timeoutMs: config.cliTimeoutMs, autoLaunch: config.autoLaunch, launchWaitMs: config.launchWaitMs, obsidianAppPath: config.obsidianAppPath });
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
