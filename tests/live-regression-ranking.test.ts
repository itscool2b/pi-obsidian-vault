import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";

const PER_STEP_PATH = "Research/Integrated Gradients/2.8 Per-Step IG.md";
const MOC_PATH = "Research/Integrated Gradients/00 Integrated Gradients MOC.md";
const PROJECT_PATH = "Projects/Pi Retrieval Project.md";

function liveRegressionCli(): FakeObsidianCliBackend {
  const cli = new FakeObsidianCliBackend();
  cli.addNote({
    path: PER_STEP_PATH,
    title: "2.8 Per-Step IG",
    aliases: ["Per-Step Integrated Gradients", "Per-Step IG"],
    tags: ["per-step", "integrated-gradients"],
    properties: { type: "content", status: "draft" },
    links: [MOC_PATH],
    content: "# 2.8 Per-Step IG\nPer-step integrated gradients records attribution at each optimization step.\nThis content note links back to the Integrated Gradients MOC for connections, links, backlinks, and related notes, but it is not the MOC itself.\n## Method\nCompute per-step integrated gradients for each optimization step and compare attribution deltas.",
  });
  cli.addNote({
    path: MOC_PATH,
    title: "00 Integrated Gradients MOC",
    aliases: ["Integrated Gradients MOC", "IG MOC"],
    tags: ["moc", "integrated-gradients"],
    properties: { type: "meta", hub: "Integrated Gradients" },
    links: [PER_STEP_PATH],
    content: "# 00 Integrated Gradients MOC\nMap of content for integrated gradients.\n## Entry Points\nStart with [[2.8 Per-Step IG]] for per-step integrated gradients.\n## Main Spine\nThe main spine links overview, roadmap, and per-step work.\n## By Note Type\nContent notes, paper notes, and implementation notes.",
  });
  cli.addNote({
    path: PROJECT_PATH,
    title: "Pi Retrieval Project",
    tags: ["project", "retrieval"],
    properties: { project: "Pi", status: "active" },
    content: "# Pi Retrieval Project\n## Overview\nThis read-only retrieval project identifies candidate notes and returns bounded context instead of vault dumps.\n## Phase Progression\nThe project progressed from CLI discovery, to ranking hardening, to phase-by-phase context selection improvements.\n## What's left\nThe project has leftover cleanup notes and generic follow-up tasks.",
  });
  return cli;
}

describe("live retrieval regressions", () => {
  it("ranks the per-step integrated gradients content note above the MOC for normal search/context intent", async () => {
    const query = "Find my note about per-step integrated gradients and show me the most relevant bounded context";
    const result = await obsidianRetrieve(liveRegressionCli(), { query, mode: "search", budget: "expanded" });
    const paths = result.candidates.map((candidate) => candidate.path);

    expect(paths).toContain(PER_STEP_PATH);
    expect(paths).toContain(MOC_PATH);
    expect(paths.indexOf(PER_STEP_PATH)).toBeLessThan(paths.indexOf(MOC_PATH));
    expect(result.agentGuidance.bestMatch?.path).toBe(PER_STEP_PATH);

    const context = await obsidianRetrieve(liveRegressionCli(), {
      query,
      mode: "context",
      selected: [{ path: MOC_PATH, title: "00 Integrated Gradients MOC" }, { path: PER_STEP_PATH, title: "2.8 Per-Step IG" }],
      budget: "expanded",
    });
    expect(context.candidates[0]?.path).toBe(PER_STEP_PATH);
    expect(context.context?.[0]?.path).toBe(PER_STEP_PATH);
  });

  it("still ranks the MOC first for explicit MOC and graph intent", async () => {
    const search = await obsidianRetrieve(liveRegressionCli(), { query: "Integrated Gradients MOC", mode: "search", budget: "expanded" });
    expect(search.candidates[0]?.path).toBe(MOC_PATH);

    const graph = await obsidianRetrieve(liveRegressionCli(), { query: "Integrated Gradients MOC", mode: "graph", budget: "expanded" });
    expect(graph.candidates[0]?.path).toBe(MOC_PATH);
    expect(graph.graph?.centerPath).toBe(MOC_PATH);
  });

  it("ranks the MOC first for explicit graph connection queries around the MOC", async () => {
    const naturalGraph = await obsidianRetrieve(liveRegressionCli(), {
      query: "Show me the connections around my Integrated Gradients MOC",
      mode: "graph",
      budget: "expanded",
    });
    expect(naturalGraph.candidates[0]?.path).toBe(MOC_PATH);
    expect(naturalGraph.graph?.centerPath).toBe(MOC_PATH);

    const keywordQuery = "Integrated Gradients MOC connections links backlinks related notes";
    const keywordSearch = await obsidianRetrieve(liveRegressionCli(), {
      query: keywordQuery,
      mode: "search",
      budget: "expanded",
    });
    expect(keywordSearch.candidates[0]?.path).toBe(MOC_PATH);

    const keywordGraph = await obsidianRetrieve(liveRegressionCli(), {
      query: keywordQuery,
      mode: "graph",
      budget: "expanded",
    });
    expect(keywordGraph.candidates[0]?.path).toBe(MOC_PATH);
    expect(keywordGraph.graph?.centerPath).toBe(MOC_PATH);
  });

  it("keeps the short per-step integrated gradients query on the content note", async () => {
    const search = await obsidianRetrieve(liveRegressionCli(), { query: "per-step integrated gradients", mode: "search", budget: "expanded" });
    expect(search.candidates[0]?.path).toBe(PER_STEP_PATH);

    const context = await obsidianRetrieve(liveRegressionCli(), {
      query: "per-step integrated gradients",
      mode: "context",
      selected: [{ path: MOC_PATH, title: "00 Integrated Gradients MOC" }, { path: PER_STEP_PATH, title: "2.8 Per-Step IG" }],
      budget: "expanded",
    });
    expect(context.candidates[0]?.path).toBe(PER_STEP_PATH);
    expect(context.context?.[0]?.path).toBe(PER_STEP_PATH);
  });

  it("uses an exact MOC path as a deterministic graph center", async () => {
    const graph = await obsidianRetrieve(liveRegressionCli(), { query: MOC_PATH, mode: "graph", budget: "expanded" });
    expect(graph.candidates[0]?.path).toBe(MOC_PATH);
    expect(graph.graph?.centerPath).toBe(MOC_PATH);
    expect(graph.agentGuidance.bestMatch?.path).toBe(MOC_PATH);
  });

  it("prioritizes overview and phase/progression sections above weak generic What's left overlap", async () => {
    const result = await obsidianRetrieve(liveRegressionCli(), {
      query: "what the project is and how it progressed",
      mode: "context",
      selected: [{ path: PROJECT_PATH, title: "Pi Retrieval Project" }],
      budget: "expanded",
    });
    const headings = result.context?.[0]?.sections.map((section) => section.heading) ?? [];
    const overviewIndex = headings.indexOf("Overview");
    const progressionIndex = headings.indexOf("Phase Progression");
    const whatsLeftIndex = headings.indexOf("What's left");

    expect(overviewIndex).toBeGreaterThanOrEqual(0);
    expect(progressionIndex).toBeGreaterThanOrEqual(0);
    expect(whatsLeftIndex).toBeGreaterThanOrEqual(0);
    expect(overviewIndex).toBeLessThan(whatsLeftIndex);
    expect(progressionIndex).toBeLessThan(whatsLeftIndex);
  });
});
