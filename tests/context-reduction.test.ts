import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { baselineFirstResponseChars, knownFailedQueries, seededFakeCli } from "./fake-obsidian-cli.js";

describe("candidate-discovery context reduction", () => {
  it("uses at least 60% less context than the filesystem-first baseline", async () => {
    const sizes: number[] = [];
    for (const scenario of knownFailedQueries) {
      const result = await obsidianRetrieve(seededFakeCli(), { query: scenario.query, mode: "search", budget: "standard" });
      sizes.push(JSON.stringify(result).length);
    }
    sizes.sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
    const reduction = 1 - median / baselineFirstResponseChars;
    expect(reduction).toBeGreaterThanOrEqual(0.6);
  });
});
