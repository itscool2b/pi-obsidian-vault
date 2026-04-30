import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ObsidianCliAdapter } from "../src/obsidian-cli.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { obsidianWrite } from "../src/write-engine.js";

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

  it.skipIf(process.env.OBSIDIAN_EVAL_WRITE !== "true")("previews safe-writing requests against a configured local vault without mutating notes", async () => {
    const config = await loadConfig();
    expect(config.vaultRoot).toBeTruthy();

    const createPath = process.env.OBSIDIAN_EVAL_WRITE_CREATE_PATH ?? "_pi_write_smoke/Dry Run Preview.md";
    const createPreview = await obsidianWrite({ operation: "create", path: createPath, content: "# Pi write smoke dry-run\n", dryRun: true }, { vaultRoot: config.vaultRoot });
    expect(["preview", "conflict"]).toContain(createPreview.status);
    expect(createPreview.committed).toBe(false);
    expect(JSON.stringify(createPreview)).not.toContain(config.vaultRoot);

    const appendPath = process.env.OBSIDIAN_EVAL_WRITE_APPEND_PATH;
    if (appendPath) {
      const appendPreview = await obsidianWrite({ operation: "append", path: appendPath, content: "\nPi write smoke dry-run append.\n", dryRun: true }, { vaultRoot: config.vaultRoot });
      expect(["preview", "missing_target"]).toContain(appendPreview.status);
      expect(appendPreview.committed).toBe(false);
      expect(JSON.stringify(appendPreview)).not.toContain(config.vaultRoot);
    }
  });
});
