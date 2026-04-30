import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ObsidianCliAdapter } from "../src/obsidian-cli.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";

describe("real-vault evaluation", () => {
  it.skipIf(process.env.OBSIDIAN_EVAL_VAULT !== "true")("collects redacted retrieval metrics against a configured vault", async () => {
    const config = await loadConfig();
    expect(config.vaultRoot || config.vaultTarget).toBeTruthy();
    const backend = new ObsidianCliAdapter({ cliPath: config.cliPath, vaultTarget: config.vaultTarget, cwd: config.vaultRoot, timeoutMs: config.cliTimeoutMs });
    const defaultQueries = ["per-step integrated gradients", "connections around Integrated Gradients MOC", "zzzxxy nonexistent blorptastic note thing"];
    const queries = (process.env.OBSIDIAN_EVAL_QUERIES?.split("|").map((item) => item.trim()).filter(Boolean)) ?? [process.env.OBSIDIAN_EVAL_QUERY ?? defaultQueries[0] ?? "project"];
    for (const query of queries) {
      const mode = query.toLowerCase().includes("connections") ? "graph" : "search";
      const result = await obsidianRetrieve(backend, { query, mode, budget: "tiny" }, { budgetChars: config.budgetChars });
      const metrics = {
        candidateCount: result.candidates.length,
        usedChars: result.budget.usedChars,
        maxChars: result.budget.maxChars,
        metadataCoverage: result.candidates.length === 0 ? 100 : Math.round((result.candidates.filter((candidate) => candidate.metadata).length / result.candidates.length) * 100),
        hasAgentGuidance: Boolean(result.agentGuidance),
      };
      expect(metrics.hasAgentGuidance).toBe(true);
      expect(result.agentGuidance.contextRecommendation.selected.length).toBeLessThanOrEqual(1);
      expect(metrics.usedChars).toBeLessThanOrEqual(metrics.maxChars);
    }
  });
});
