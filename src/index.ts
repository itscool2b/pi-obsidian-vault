import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, statusFromConfig, type LoadConfigOptions } from "./config.js";
import { ObsidianCliAdapter } from "./obsidian-cli.js";
import { obsidianRetrieve } from "./retrieval-engine.js";
import type { BudgetProfile, ObsidianCliBackend, RetrievalRequest } from "./retrieval-types.js";

export * from "./retrieval-types.js";
export { loadConfig } from "./config.js";
export { ObsidianCliAdapter } from "./obsidian-cli.js";
export { obsidianRetrieve } from "./retrieval-engine.js";

export interface RegisterObsidianVaultOptions extends LoadConfigOptions {
  backend?: ObsidianCliBackend | undefined;
}

const Budget = Type.Union([Type.Literal("tiny"), Type.Literal("standard"), Type.Literal("expanded")]);
const Mode = Type.Union([Type.Literal("auto"), Type.Literal("search"), Type.Literal("context"), Type.Literal("graph"), Type.Literal("project")]);
const Include = Type.Union([
  Type.Literal("metadata"),
  Type.Literal("links"),
  Type.Literal("backlinks"),
  Type.Literal("aliases"),
  Type.Literal("tags"),
  Type.Literal("properties"),
  Type.Literal("recents"),
  Type.Literal("sections"),
  Type.Literal("graph"),
  Type.Literal("suggestions"),
]);

const ObsidianRetrieveParams = Type.Object({
  query: Type.Optional(Type.String({ description: "Natural-language query, title, alias, tag, property, or project/topic phrase." })),
  mode: Type.Optional(Mode),
  selected: Type.Optional(Type.Array(Type.Object({
    path: Type.String({ description: "Vault-relative Markdown path returned by a previous obsidian_retrieve call." }),
    title: Type.Optional(Type.String()),
  }))),
  scope: Type.Optional(Type.Object({
    folder: Type.Optional(Type.String({ description: "Optional vault-relative folder scope. Used as a seed signal only; never dumped." })),
    tags: Type.Optional(Type.Array(Type.String())),
    properties: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]))),
    recent: Type.Optional(Type.Boolean()),
  })),
  include: Type.Optional(Type.Array(Include)),
  budget: Type.Optional(Budget),
  maxCandidates: Type.Optional(Type.Number({ minimum: 1, maximum: 12 })),
  explain: Type.Optional(Type.Boolean()),
});

export function registerObsidianVault(pi: Pick<ExtensionAPI, "registerTool" | "registerCommand">, options: RegisterObsidianVaultOptions = {}): void {
  pi.registerTool({
    name: "obsidian_retrieve",
    label: "Obsidian Retrieve",
    description: "Retrieve ranked Obsidian note candidates and bounded selected-note context through the official Obsidian CLI. Read-only and candidate-first.",
    promptSnippet: "Use obsidian_retrieve first for Obsidian questions. Start with mode=search/auto, then request mode=context for selected candidate paths.",
    promptGuidelines: [
      "Use obsidian_retrieve as the only Obsidian-facing retrieval tool.",
      "Start with candidate discovery; do not ask for broad note, folder, or vault dumps.",
      "Call mode=context only for specific selected candidate paths returned by a prior retrieval.",
      "Use mode=graph or mode=project for bounded relationship/project summaries; outputs still remain candidate-first.",
      "This tool is read-only. It does not open Obsidian and does not write, append, rename, move, or delete notes.",
    ],
    parameters: ObsidianRetrieveParams,
    async execute(_toolCallId: string, params: RetrievalRequest) {
      const backend = await backendFromOptions(options);
      const config = options.backend ? undefined : await loadConfig(options);
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
      const health = await backend.checkHealth();
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
  return new ObsidianCliAdapter({ cliPath: config.cliPath, vaultTarget: config.vaultTarget, cwd: config.vaultRoot, timeoutMs: config.cliTimeoutMs });
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
