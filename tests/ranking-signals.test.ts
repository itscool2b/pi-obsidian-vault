import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("ranking signals", () => {
  it("ranks exact title, fuzzy title, alias, tag, property, heading, content, and recency signals", async () => {
    const cases = [
      { query: "Integrated Gradients", path: "Research/Integrated Gradients/index.md", signal: "title" },
      { query: "graidents", path: "Research/Integrated Gradients/index.md", signal: "fuzzy" },
      { query: "IG", path: "Research/Integrated Gradients/index.md", signal: "alias" },
      { query: "attribution", path: "Papers/Axiomatic Attribution.md", signal: "tag" },
      { query: "Interpretability", path: "Research/Integrated Gradients/index.md", signal: "property" },
      { query: "Month 3", path: "Research/Integrated Gradients/Roadmap.md", signal: "heading" },
      { query: "bounded context packing", path: "Projects/Pi Obsidian Harness.md", signal: "content" },
      { query: "Pi Obsidian Harness", path: "Projects/Pi Obsidian Harness.md", signal: "recency" },
    ];

    for (const item of cases) {
      const result = await obsidianRetrieve(seededFakeCli(), { query: item.query, mode: "search", budget: "expanded" });
      expect(result.candidates[0]?.path, item.query).toBe(item.path);
      expect(result.candidates[0]?.availableSignals, item.query).toContain(item.signal);
    }
  });
});
