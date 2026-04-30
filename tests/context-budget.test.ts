import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("context budgets", () => {
  it("enforces per-section, per-note, selected-note-count, and total output budgets", async () => {
    const backend = seededFakeCli();
    backend.addNote({
      path: "Long.md",
      title: "Long Note",
      content: `# Long\n${"important context ".repeat(1000)}\n## Later\n${"more context ".repeat(1000)}`,
      tags: ["long"],
    });

    const result = await obsidianRetrieve(backend, {
      mode: "context",
      query: "important context",
      budget: "tiny",
      selected: [{ path: "Long.md", title: "Long Note" }, { path: "Research/Integrated Gradients/index.md" }, { path: "Projects/Pi Obsidian Harness.md" }],
    });

    expect(result.agentGuidance).toMatchObject({
      resultState: "context_returned",
      bestMatch: expect.any(Object),
      confidence: { level: expect.any(String), rationale: expect.any(String) },
      contextRecommendation: { answerScope: "use_returned_context" },
      nextActions: expect.any(Array),
    });
    expect(result.context?.length).toBeLessThanOrEqual(2);
    for (const pkg of result.context ?? []) {
      expect(pkg.usedChars).toBeLessThanOrEqual(1000);
      for (const section of pkg.sections) expect(section.excerpt.length).toBeLessThanOrEqual(500);
    }
    expect(result.budget.usedChars).toBeLessThanOrEqual(result.budget.maxChars);
  });

  it("preserves at least 1,200 excerpt characters or two relevant sections for standard context when available", async () => {
    const backend = seededFakeCli();
    backend.addNote({
      path: "Long Standard.md",
      title: "Long Standard",
      content: `# Long Standard\n${"important context alpha ".repeat(80)}\n## Important Details\n${"important context beta ".repeat(80)}\n## Important More\n${"important context gamma ".repeat(80)}`,
      tags: ["long"],
    });

    const result = await obsidianRetrieve(backend, {
      mode: "context",
      query: "important context",
      budget: "standard",
      selected: [{ path: "Long Standard.md", title: "Long Standard" }],
    });

    const sections = result.context?.[0]?.sections ?? [];
    const excerptChars = sections.reduce((sum, section) => sum + section.excerpt.length, 0);
    expect(excerptChars >= 1_200 || sections.length >= 2).toBe(true);
    expect(result.budget.usedChars).toBeLessThanOrEqual(result.budget.maxChars);
    if (result.budget.truncated) expect(excerptChars).toBeGreaterThanOrEqual(1_200);
  });
});
