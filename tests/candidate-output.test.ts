import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("compact candidate output", () => {
  it("caps previews, avoids full bodies, and covers required metadata on at least 95% of candidates", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "integrated", mode: "search", budget: "standard" });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.preview.length).toBeLessThanOrEqual(240);
      expect(candidate.path).toMatch(/\.md$/);
      expect(candidate.title).toBeTruthy();
      expect(candidate.metadata).toBeTruthy();
    }
    expect(JSON.stringify(result)).not.toContain("Use path integral baselines and attribution tests.");
    const covered = result.candidates.filter((candidate) => candidate.path && candidate.title && candidate.metadata).length;
    expect((covered / result.candidates.length) * 100).toBeGreaterThanOrEqual(95);
  });
});
