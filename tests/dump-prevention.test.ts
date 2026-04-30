import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("dump prevention", () => {
  it("prevents full-vault, full-folder, and multi-full-note dumps", async () => {
    const backend = seededFakeCli();
    const vault = await obsidianRetrieve(backend, { query: "dump entire vault", mode: "search", budget: "tiny" });
    expect(vault.context).toBeUndefined();
    expect(vault.agentGuidance.contextRecommendation).toMatchObject({ recommended: false, selected: [], answerScope: "clarify_first" });
    expect(vault.budget.usedChars).toBeLessThanOrEqual(vault.budget.maxChars);

    const folder = await obsidianRetrieve(backend, { query: "all project notes", mode: "project", scope: { folder: "Projects" }, budget: "tiny" });
    expect(folder.candidates.length).toBeLessThanOrEqual(5);
    expect(folder.agentGuidance.contextRecommendation).toMatchObject({ recommended: false, selected: [], answerScope: "clarify_first" });
    expect(JSON.stringify(folder)).not.toContain("# Retrieval Architecture\n## CLI Adapter");

    const context = await obsidianRetrieve(backend, { mode: "context", query: "context", budget: "tiny", selected: [
      { path: "Research/Integrated Gradients/index.md" },
      { path: "Projects/Pi Obsidian Harness.md" },
      { path: "Projects/Pi Obsidian Harness/Architecture.md" },
    ] });
    expect(context.context?.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(context.budget.maxChars + 500);
  });
});
