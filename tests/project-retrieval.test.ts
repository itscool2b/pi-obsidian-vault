import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("project retrieval", () => {
  it("combines folder, hub, roadmap, source, tag, property, and recent signals without dumping folders", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), {
      query: "Pi Obsidian Harness",
      mode: "project",
      scope: { folder: "Projects", tags: ["pi"], properties: { project: "Pi" }, recent: true },
      budget: "standard",
    });

    expect(result.mode).toBe("project");
    expect(result.candidates[0]?.path).toBe("Projects/Pi Obsidian Harness.md");
    expect(result.candidates.map((candidate) => candidate.path)).toContain("Projects/Pi Obsidian Harness/Architecture.md");
    expect(result.graph).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("Never dump a folder or full vault.");
    expect(result.budget.usedChars).toBeLessThanOrEqual(result.budget.maxChars);
  });
});
