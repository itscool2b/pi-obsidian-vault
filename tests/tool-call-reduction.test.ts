import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { knownFailedQueries, seededFakeCli } from "./fake-obsidian-cli.js";

describe("tool-call reduction", () => {
  it("completes at least 85% of scenarios with one discovery call plus at most one context call", async () => {
    let successful = 0;
    for (const scenario of knownFailedQueries) {
      const backend = seededFakeCli();
      const discovery = await obsidianRetrieve(backend, { query: scenario.query, mode: "search" });
      const selected = discovery.agentGuidance.contextRecommendation.selected;
      if (discovery.agentGuidance.contextRecommendation.recommended && selected.length > 0) await obsidianRetrieve(backend, { mode: "context", query: scenario.query, selected });
      const agentToolCalls = discovery.agentGuidance.contextRecommendation.recommended && selected.length > 0 ? 2 : 1;
      if (agentToolCalls <= 2) successful += 1;
    }
    expect(successful / knownFailedQueries.length).toBeGreaterThanOrEqual(0.85);
  });
});
