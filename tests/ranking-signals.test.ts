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

  it("prefers exact phrases and meaningful title evidence over weak isolated tokens", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "per-step integrated gradients", mode: "search", budget: "standard" });

    expect(result.candidates[0]?.path).toBe("Research/Integrated Gradients/Per-Step IG.md");
    const weakDistractorIndex = result.candidates.findIndex((candidate) => candidate.path === "Archive/Per Token Distractor.md");
    expect(weakDistractorIndex === -1 || weakDistractorIndex > 0).toBe(true);
    expect(result.candidates[0]?.matchReasons.some((reason) => reason.quality === "strong" && /step integrated gradients|Per-Step Integrated Gradients/i.test(reason.evidence))).toBe(true);
  });

  it("ranks exact phrase candidates above separated-token distractors", async () => {
    const backend = seededFakeCli();
    backend.addNote({ path: "Research/Phrase Target.md", title: "Phrase Target", content: "# Phrase Target\nalpha beta gamma appears together here." });
    backend.addNote({ path: "Research/Separated Tokens.md", title: "Separated Tokens", content: "# Separated Tokens\nalpha appears early. beta appears later. gamma appears at the end." });

    const result = await obsidianRetrieve(backend, { query: "alpha beta gamma", mode: "search", budget: "standard" });

    expect(result.candidates[0]?.path).toBe("Research/Phrase Target.md");
  });
});
