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
      expect(candidate.selectedRef).toEqual({ path: candidate.path, title: candidate.title });
      expect(candidate.confidenceLevel).toMatch(/^(high|medium|low|none)$/);
      expect(candidate.matchSummary?.headline).toBeTruthy();
      expect(candidate.matchSummary?.signals[0]).toMatchObject({ signal: expect.any(String), evidence: expect.any(String), why: expect.any(String) });
    }
    expect(JSON.stringify(result)).not.toContain("Use path integral baselines and attribution tests.");
    const covered = result.candidates.filter((candidate) => candidate.path && candidate.title && candidate.metadata).length;
    expect((covered / result.candidates.length) * 100).toBeGreaterThanOrEqual(95);
  });

  it("explains strong structured evidence instead of weak isolated tokens", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "per-step integrated gradients", mode: "search", budget: "standard" });
    const top = result.candidates[0];

    expect(top?.path).toBe("Research/Integrated Gradients/Per-Step IG.md");
    expect(top?.matchSummary?.signals.some((signal) => ["title", "alias", "tag", "heading", "path", "property"].includes(signal.signal))).toBe(true);
    expect(top?.matchSummary?.signals[0]?.why).not.toMatch(/generic terms|weak isolated/i);
  });
});
