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

  it("returns stable no-match guidance when no candidates are available", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "qwertyuiopasdfghjkl", mode: "search", budget: "tiny" });

    expect(result.candidates).toEqual([]);
    expect(result.agentGuidance).toMatchObject({
      resultState: "no_match",
      bestMatch: null,
      confidence: { level: "none", ambiguous: false },
      contextRecommendation: { recommended: false, selected: [], mode: "none", answerScope: "clarify_first" },
    });
    expect(result.agentGuidance.nextActions[0]).toMatchObject({ priority: 1, action: "refine_query" });
  });

  it("returns no_match for nonexistent queries instead of weak generic candidates", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "zzzxxy nonexistent blorptastic note thing", mode: "search", budget: "standard" });

    expect(result.agentGuidance.resultState).toBe("no_match");
    expect(result.agentGuidance.bestMatch).toBeNull();
    expect(result.agentGuidance.confidence.level).toBe("none");
    expect(result.agentGuidance.contextRecommendation).toMatchObject({ recommended: false, selected: [], mode: "none" });
    expect(result.agentGuidance.contextRecommendation.selected).toEqual([]);
  });
});
