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

  it("marks close project candidates ambiguous using the pinned relative score margin", async () => {
    const backend = seededFakeCli();
    backend.addNote({ path: "Projects/Close A.md", title: "Close Project A", content: "# Close Project A\nclose project", tags: ["close"] });
    backend.addNote({ path: "Projects/Close B.md", title: "Close Project B", content: "# Close Project B\nclose project", tags: ["close"] });

    const result = await obsidianRetrieve(backend, { query: "close project", mode: "project", scope: { folder: "Projects" }, budget: "standard" });

    expect(result.agentGuidance.resultState).toBe("ambiguous");
    expect(result.agentGuidance.confidence.ambiguous).toBe(true);
    expect(result.agentGuidance.confidence.marginToNext).toBeLessThanOrEqual(0.15);
    expect(result.agentGuidance.alternatives.length).toBeGreaterThan(0);
    expect(result.agentGuidance.nextActions[0]?.action).toBe("clarify");
  });

  it("declines project targets supported only by generic terms", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "general project details", mode: "project", scope: { folder: "Projects" }, budget: "standard" });

    expect(result.graph?.centerPath).toBeUndefined();
    expect(result.agentGuidance.resultState).toBe("no_match");
    expect(result.agentGuidance.contextRecommendation).toMatchObject({ recommended: false, selected: [], mode: "none" });
    expect(result.warnings.join("\n")).toMatch(/No reliable project target/i);
  });
});
