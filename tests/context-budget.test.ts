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

    expect(result.context?.length).toBeLessThanOrEqual(2);
    for (const pkg of result.context ?? []) {
      expect(pkg.usedChars).toBeLessThanOrEqual(1000);
      for (const section of pkg.sections) expect(section.excerpt.length).toBeLessThanOrEqual(500);
    }
    expect(result.budget.usedChars).toBeLessThanOrEqual(result.budget.maxChars);
  });
});
