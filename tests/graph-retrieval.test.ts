import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("graph retrieval", () => {
  it("returns bounded links, backlinks, neighboring notes, and relationship summaries", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "Integrated Gradients", mode: "graph", budget: "standard" });

    expect(result.mode).toBe("graph");
    expect(result.graph?.centerPath).toBe("Research/Integrated Gradients/index.md");
    expect(result.graph?.outgoing?.map((note) => note.path)).toContain("Research/Integrated Gradients/Roadmap.md");
    expect(result.graph?.backlinks?.map((note) => note.path)).toContain("Research/Integrated Gradients/Roadmap.md");
    expect((result.graph?.outgoing?.length ?? 0) + (result.graph?.backlinks?.length ?? 0)).toBeLessThanOrEqual(16);
    expect(result.budget.usedChars).toBeLessThanOrEqual(result.budget.maxChars);
  });
});
