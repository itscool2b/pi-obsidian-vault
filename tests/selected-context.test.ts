import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("selected-candidate context mode", () => {
  it("loads bounded excerpts only for selected candidates", async () => {
    const backend = seededFakeCli();
    const discovery = await obsidianRetrieve(backend, { query: "Integrated Gradients", mode: "search" });
    const selected = discovery.candidates.slice(0, 1).map((candidate) => ({ path: candidate.path, title: candidate.title }));

    const context = await obsidianRetrieve(backend, { mode: "context", query: "implementation", selected, budget: "standard" });

    expect(context.mode).toBe("context");
    expect(context.context).toHaveLength(1);
    expect(context.context?.[0]?.path).toBe(selected[0]?.path);
    expect(context.context?.[0]?.sections.length).toBeGreaterThan(0);
    expect(context.context?.[0]?.sections[0]?.excerpt.length).toBeLessThanOrEqual(900);
    expect(context.budget.usedChars).toBeLessThanOrEqual(context.budget.maxChars);
    expect(backend.readPaths()).toEqual([selected[0]?.path]);
  });
});
