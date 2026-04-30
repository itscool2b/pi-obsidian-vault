import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("graph and project ranking signals", () => {
  it("captures backlink, outgoing-link, project-folder, shared metadata, and recency signals", async () => {
    const graph = await obsidianRetrieve(seededFakeCli(), { query: "Axiomatic Attribution", mode: "graph", budget: "expanded" });
    expect(graph.graph?.outgoing?.map((note) => note.path)).toContain("Research/Integrated Gradients/index.md");
    expect(graph.candidates[0]?.availableSignals).toEqual(expect.arrayContaining(["title", "tag"]));

    const project = await obsidianRetrieve(seededFakeCli(), { query: "Pi", mode: "project", scope: { folder: "Projects", tags: ["pi"], properties: { project: "Pi" }, recent: true } });
    expect(project.candidates[0]?.availableSignals).toEqual(expect.arrayContaining(["project_folder", "tag", "property", "recency"]));
    expect(project.candidates[0]?.metadata.links?.length ?? 0).toBeGreaterThan(0);
  });
});
