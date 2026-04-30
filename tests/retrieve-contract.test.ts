import { describe, expect, it } from "vitest";
import { registerObsidianVault } from "../src/index.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

function fakePi() {
  return {
    tools: new Map<string, any>(),
    commands: new Map<string, any>(),
    registerTool(tool: any) { this.tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { this.commands.set(name, command); },
  };
}

describe("obsidian_retrieve contract", () => {
  it("registers only obsidian_retrieve plus status command and supports backend injection", async () => {
    const pi = fakePi();
    const backend = seededFakeCli();
    registerObsidianVault(pi as any, { backend });

    expect([...pi.tools.keys()]).toEqual(["obsidian_retrieve"]);
    expect(pi.commands.has("obsidian-vault")).toBe(true);
    const result = await pi.tools.get("obsidian_retrieve").execute("id", { query: "IG", mode: "search" });
    expect(result.details.candidates[0].path).toBe("Research/Integrated Gradients/index.md");
  });

  it("validates inputs and returns candidate-first output shape without note bodies", async () => {
    const backend = seededFakeCli();
    await expect(obsidianRetrieve(backend, { mode: "search" })).rejects.toThrow(/requires a query/i);

    const result = await obsidianRetrieve(backend, { query: "integrated gradients", mode: "search", budget: "tiny" });

    expect(result).toMatchObject({ mode: "search", query: "integrated gradients", budget: { profile: "tiny", maxChars: expect.any(Number) } });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]).toMatchObject({ rank: 1, score: expect.any(Number), path: expect.stringContaining(".md"), title: expect.any(String), preview: expect.any(String), matchReasons: expect.any(Array), metadata: expect.any(Object) });
    expect(result.context).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("Use path integral baselines and attribution tests");
    expect(result.budget.usedChars).toBeLessThanOrEqual(result.budget.maxChars);
  });

  it("warns on write/open intent instead of exposing side-effect tools", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "open and append integrated gradients", mode: "search" });
    expect(result.warnings.join("\n")).toMatch(/read-only/i);
  });
});
