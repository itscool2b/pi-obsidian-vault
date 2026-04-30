import { describe, expect, it } from "vitest";
import { ambiguityMargin, buildAgentGuidance, enrichCandidateForAgent, selectedRefForCandidate } from "../src/agent-guidance.js";
import type { RankedCandidate } from "../src/retrieval-types.js";

function candidate(input: { path: string; title: string; rank: number; score: number; confidence: number }): RankedCandidate {
  return enrichCandidateForAgent({
    rank: input.rank,
    score: input.score,
    confidence: input.confidence,
    path: input.path,
    title: input.title,
    preview: input.title,
    matchReasons: [{ signal: "title", field: "title", evidence: input.title, score: input.score }],
    metadata: {},
    availableSignals: ["title"],
  });
}

describe("agent guidance helpers", () => {
  it("creates selected refs only for safe markdown candidates", () => {
    expect(selectedRefForCandidate({ path: "Research/Safe.md", title: "Safe" })).toEqual({ path: "Research/Safe.md", title: "Safe" });
    expect(selectedRefForCandidate({ path: ".obsidian/Bad.md", title: "Bad" })).toBeUndefined();
    expect(selectedRefForCandidate({ path: "../Bad.md", title: "Bad" })).toBeUndefined();
  });

  it("uses the pinned 15% ambiguity margin and deterministic ordering", () => {
    const candidates = [
      candidate({ path: "Projects/Top.md", title: "Top", rank: 1, score: 100, confidence: 0.9 }),
      candidate({ path: "Projects/B.md", title: "B", rank: 2, score: 90, confidence: 0.8 }),
      candidate({ path: "Projects/A.md", title: "A", rank: 3, score: 90, confidence: 0.8 }),
    ];

    expect(ambiguityMargin(100, 85)).toBe(0.15);
    const first = buildAgentGuidance({ mode: "search", query: "project", candidates });
    const second = buildAgentGuidance({ mode: "search", query: "project", candidates });

    expect(first.confidence.ambiguous).toBe(true);
    expect(first.resultState).toBe("ambiguous");
    expect(first.confidence.marginToNext).toBe(0.1);
    expect(first.alternatives.map((item) => item.path)).toEqual(["Projects/A.md", "Projects/B.md"]);
    expect(first.nextActions.map((action) => action.action)).toEqual(["clarify", "inspect_alternative"]);
    expect(second.alternatives).toEqual(first.alternatives);
    expect(second.nextActions).toEqual(first.nextActions);
  });
});
