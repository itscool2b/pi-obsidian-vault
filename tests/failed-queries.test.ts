import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { knownFailedQueries, seededFakeCli } from "./fake-obsidian-cli.js";

describe("known failed vault queries", () => {
  it("places expected targets in the top 5 and reports category data for misses", async () => {
    const misses: Array<{ query: string; category: string; paths: string[] }> = [];
    for (const scenario of knownFailedQueries) {
      const result = await obsidianRetrieve(seededFakeCli(), { query: scenario.query, mode: "search", budget: "standard" });
      const top5 = result.candidates.slice(0, 5).map((candidate) => candidate.path);
      if (!top5.includes(scenario.expectedPath)) misses.push({ query: scenario.query, category: scenario.category, paths: top5 });
    }
    expect(misses).toEqual([]);
  });
});
