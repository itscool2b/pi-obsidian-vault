import { describe, expect, it } from "vitest";
import { obsidianPlan } from "../src/plan-engine.js";
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
    expect(context.agentGuidance.contextRecommendation).toMatchObject({ recommended: false, answerScope: "use_returned_context" });
    expect(context.agentGuidance.contextRecommendation.selected.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(context.agentGuidance.contextRecommendation)).not.toContain("Projects/Pi Obsidian Harness/Architecture.md");
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(context.budget.maxChars + 500);
  });

  it("keeps relationship and plan preview outputs from becoming vault or note dumps", async () => {
    const backend = seededFakeCli();
    const relationships: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Research/Integrated Gradients/index.md", includeSections: true, budget: "tiny" });
    expect(relationships.context).toBeUndefined();
    expect(relationships.candidates).toEqual([]);
    expect(JSON.stringify(relationships)).not.toContain("Use path integral baselines and attribution tests");
    expect(backend.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["files", "folders", "search"]));

    const plan = await obsidianPlan({ operations: [{ tool: "obsidian_retrieve", operation: "relationships", path: "Research/Integrated Gradients/index.md" }] });
    expect(JSON.stringify(plan)).not.toContain("Use path integral baselines");
    expect(plan.summary.previewOnly).toBe(true);
  });
});
