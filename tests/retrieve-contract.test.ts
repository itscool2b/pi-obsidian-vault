import { describe, expect, it } from "vitest";
import { registerObsidianVault } from "../src/index.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli, unexpectedFakeCliSideEffectCalls } from "./fake-obsidian-cli.js";
import { seedNote, vaultSnapshot, withTempVault } from "./write-test-utils.js";

function fakePi() {
  return {
    tools: new Map<string, any>(),
    commands: new Map<string, any>(),
    registerTool(tool: any) { this.tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { this.commands.set(name, command); },
  };
}

describe("obsidian_retrieve contract", () => {
  it("registers obsidian_retrieve, obsidian_write, obsidian_edit, obsidian_manage, plus status command and supports backend injection", async () => {
    const pi = fakePi();
    const backend = seededFakeCli();
    registerObsidianVault(pi as any, { backend });

    expect([...pi.tools.keys()]).toEqual(["obsidian_retrieve", "obsidian_validate", "obsidian_write", "obsidian_edit", "obsidian_manage"]);
    expect(pi.commands.has("obsidian-vault")).toBe(true);
    const result = await pi.tools.get("obsidian_retrieve").execute("id", { query: "IG", mode: "search" });
    expect(result.details.candidates[0].path).toBe("Research/Integrated Gradients/index.md");
  });

  it("validates inputs and returns candidate-first output shape without note bodies", async () => {
    const backend = seededFakeCli();
    await expect(obsidianRetrieve(backend, { mode: "search" })).rejects.toThrow(/requires a query/i);

    const result = await obsidianRetrieve(backend, { query: "integrated gradients", mode: "search", budget: "tiny" });

    expect(result).toMatchObject({ mode: "search", query: "integrated gradients", budget: { profile: "tiny", maxChars: expect.any(Number) } });
    expect(result.agentGuidance).toMatchObject({
      resultState: "request_context",
      bestMatch: { path: "Research/Integrated Gradients/index.md", selectedRef: { path: "Research/Integrated Gradients/index.md" } },
      confidence: { level: "high", ambiguous: false, rationale: expect.any(String) },
      contextRecommendation: { recommended: true, mode: "context", selected: [{ path: "Research/Integrated Gradients/index.md", title: "Integrated Gradients" }] },
      nextActions: [{ priority: 1, action: "request_context" }],
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]).toMatchObject({ rank: 1, score: expect.any(Number), path: expect.stringContaining(".md"), title: expect.any(String), preview: expect.any(String), matchReasons: expect.any(Array), metadata: expect.any(Object), selectedRef: { path: expect.stringContaining(".md") }, confidenceLevel: expect.any(String), matchSummary: { headline: expect.any(String), signals: expect.any(Array) } });
    expect(result.context).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("Use path integral baselines and attribution tests");
    expect(result.budget.usedChars).toBeLessThanOrEqual(result.budget.maxChars);
  });

  it("warns on write/open/replace intent instead of exposing side-effect tools", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "open and append integrated gradients", mode: "search" });
    expect(result.warnings.join("\n")).toMatch(/read-only/i);
    const replace = await obsidianRetrieve(seededFakeCli(), { query: "replace exact text in integrated gradients", mode: "search" });
    expect(replace.warnings.join("\n")).toMatch(/read-only/i);
    const folder = await obsidianRetrieve(seededFakeCli(), { query: "create folder Projects/New Area", mode: "search" });
    expect(folder.warnings.join("\n")).toMatch(/read-only/i);
  });

  it("does not mutate a local temp vault even for mutation-like requests", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Existing.md", "# Existing\n");
      const before = await vaultSnapshot(vaultRoot);
      const backend = seededFakeCli();
      const result = await obsidianRetrieve(backend, { query: "create append edit move trash delete Notes/Existing", mode: "search", budget: "tiny" });
      expect(result.warnings.join("\n")).toMatch(/read-only/i);
      expect(await vaultSnapshot(vaultRoot)).toEqual(before);
      expect(unexpectedFakeCliSideEffectCalls(backend)).toEqual([]);
    });
  });

  it("returns setup guidance from obsidian_retrieve itself when no vault is configured", async () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { env: {}, configPath: "/tmp/pi-obsidian-vault-missing-config.json" });

    const result = await pi.tools.get("obsidian_retrieve").execute("id", { query: "anything", mode: "search" });

    expect(result.details.candidates).toEqual([]);
    expect(result.details.warnings.join("\n")).toMatch(/obsidian-vault\.json|vault path is not configured/i);
    expect(result.details.agentGuidance).toMatchObject({
      resultState: "no_match",
      confidence: { level: "none" },
      contextRecommendation: { recommended: false, selected: [] },
      nextActions: [{ action: "stop" }],
    });
  });

  it("returns setup guidance from obsidian_retrieve itself when the CLI stays unavailable", async () => {
    const pi = fakePi();
    const backend = seededFakeCli();
    backend.available = false;
    backend.checkHealth = async () => ({ available: false, cliPath: "obsidian", errors: ["Obsidian is not running"], warnings: [] });
    registerObsidianVault(pi as any, { backend });

    const result = await pi.tools.get("obsidian_retrieve").execute("id", { query: "anything", mode: "search" });

    expect(result.details.candidates).toEqual([]);
    expect(result.details.warnings.join("\n")).toMatch(/not running|unavailable/i);
    expect(result.details.agentGuidance.nextActions[0].action).toBe("stop");
  });

  it("returns agentGuidance for every successful mode", async () => {
    const backend = seededFakeCli();
    const search = await obsidianRetrieve(backend, { query: "Integrated Gradients", mode: "search" });
    const selected = [search.candidates[0]?.selectedRef ?? { path: "Research/Integrated Gradients/index.md", title: "Integrated Gradients" }];
    const context = await obsidianRetrieve(backend, { query: "Implementation", mode: "context", selected });
    const graph = await obsidianRetrieve(seededFakeCli(), { query: "Integrated Gradients", mode: "graph" });
    const project = await obsidianRetrieve(seededFakeCli(), { query: "Pi Obsidian Harness", mode: "project", scope: { folder: "Projects" } });
    const note = await obsidianRetrieve(seededFakeCli(), { mode: "note", path: "Research/Integrated Gradients/index.md" });

    for (const result of [search, context, graph, project, note]) {
      expect(result.agentGuidance).toMatchObject({
        resultState: expect.any(String),
        confidence: { level: expect.any(String), ambiguous: expect.any(Boolean), rationale: expect.any(String) },
        contextRecommendation: { recommended: expect.any(Boolean), selected: expect.any(Array), mode: expect.any(String), answerScope: expect.any(String), reason: expect.any(String) },
        alternatives: expect.any(Array),
        nextActions: expect.any(Array),
      });
      expect(result.agentGuidance.nextActions.length).toBeGreaterThan(0);
    }
  });

  it("marks close strongly supported candidates ambiguous without recommending broad context", async () => {
    const result = await obsidianRetrieve(seededFakeCli(), { query: "ranking quality", mode: "search", budget: "standard" });

    expect(result.agentGuidance.resultState).toBe("ambiguous");
    expect(result.agentGuidance.confidence).toMatchObject({ ambiguous: true });
    expect(result.agentGuidance.contextRecommendation).toMatchObject({ recommended: false, selected: [], mode: "none", answerScope: "clarify_first" });
    expect(result.agentGuidance.alternatives.map((item) => item.path)).toEqual([...result.agentGuidance.alternatives.map((item) => item.path)].sort());
    expect(result.agentGuidance.confidence.rationale).toMatch(/Ranking Quality Alpha|Ranking Quality Beta/);
  });

  it("reports degraded signals and downgrades confidence when optional signals are unavailable", async () => {
    const backend = seededFakeCli();
    backend.aliases = async () => { throw new Error("aliases unavailable"); };
    backend.tags = async () => { throw new Error("tags unavailable"); };
    backend.properties = async () => { throw new Error("properties unavailable"); };
    backend.recents = async () => { throw new Error("recents unavailable"); };
    backend.links = async () => { throw new Error("links unavailable"); };
    backend.backlinks = async () => { throw new Error("backlinks unavailable"); };

    const result = await obsidianRetrieve(backend, { query: "Integrated Gradients", mode: "graph" });

    expect(result.warnings.join("\n")).toMatch(/signals degraded/i);
    expect(result.agentGuidance.confidence.degradedSignals).toEqual(expect.arrayContaining(["metadata", "properties", "recents", "relationships", "backlinks"]));
    expect(result.agentGuidance.confidence.level).toBe("medium");
  });
});
