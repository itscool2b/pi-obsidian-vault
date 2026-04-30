import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ObsidianCliAdapter } from "../src/obsidian-cli.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";

describe("real-vault evaluation", () => {
  it.skipIf(process.env.OBSIDIAN_EVAL_VAULT !== "true")("collects redacted retrieval metrics against a configured vault", async () => {
    const config = await loadConfig();
    expect(config.vaultRoot || config.vaultTarget).toBeTruthy();
    const backend = new ObsidianCliAdapter({ cliPath: config.cliPath, vaultTarget: config.vaultTarget, cwd: config.vaultRoot, timeoutMs: config.cliTimeoutMs });
    const query = process.env.OBSIDIAN_EVAL_QUERY ?? "project";
    const result = await obsidianRetrieve(backend, { query, mode: "search", budget: "tiny" }, { budgetChars: config.budgetChars });
    const metrics = {
      candidateCount: result.candidates.length,
      usedChars: result.budget.usedChars,
      maxChars: result.budget.maxChars,
      metadataCoverage: result.candidates.length === 0 ? 100 : Math.round((result.candidates.filter((candidate) => candidate.metadata).length / result.candidates.length) * 100),
    };
    expect(metrics.usedChars).toBeLessThanOrEqual(metrics.maxChars);
  });
});
