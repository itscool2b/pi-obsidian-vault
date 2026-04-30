import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("selected-candidate context mode", () => {
  it("loads bounded excerpts only for selected candidates", async () => {
    const backend = seededFakeCli();
    const discovery = await obsidianRetrieve(backend, { query: "Integrated Gradients", mode: "search" });
    expect(discovery.agentGuidance.contextRecommendation).toMatchObject({ recommended: true, mode: "context", selected: [{ path: "Research/Integrated Gradients/index.md", title: "Integrated Gradients" }] });
    const selected = discovery.agentGuidance.contextRecommendation.selected;

    const context = await obsidianRetrieve(backend, { mode: "context", query: "implementation", selected, budget: "standard" });

    expect(context.mode).toBe("context");
    expect(context.context).toHaveLength(1);
    expect(context.context?.[0]?.path).toBe(selected[0]?.path);
    expect(context.context?.[0]?.sections.length).toBeGreaterThan(0);
    expect(context.context?.[0]?.sections[0]?.excerpt.length).toBeLessThanOrEqual(900);
    expect(context.agentGuidance.resultState).toBe("context_returned");
    expect(context.agentGuidance.contextRecommendation).toMatchObject({ recommended: false, mode: "none", answerScope: "use_returned_context" });
    expect(context.budget.usedChars).toBeLessThanOrEqual(context.budget.maxChars);
    expect(backend.readPaths()).toEqual([selected[0]?.path]);
  });

  it("loads Project Narrative context only from the explicit selected safe path", async () => {
    const backend = seededFakeCli();
    const context = await obsidianRetrieve(backend, {
      mode: "context",
      query: "what is this project and how did it progress?",
      selected: [{ path: "Projects/Project Narrative.md", title: "Project Narrative" }],
      budget: "standard",
    });

    expect(context.context?.[0]?.path).toBe("Projects/Project Narrative.md");
    expect(context.context?.[0]?.sections[0]?.heading).toBe("Progress Timeline");
    expect(backend.readPaths()).toEqual(["Projects/Project Narrative.md"]);
  });
});
