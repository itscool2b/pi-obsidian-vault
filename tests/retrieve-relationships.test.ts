import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";

function relationshipBackend(): FakeObsidianCliBackend {
  return new FakeObsidianCliBackend()
    .addNote({
      path: "Projects/Plan.md",
      title: "Plan",
      links: ["Projects/Index.md"],
      content: "# Plan\nSee [[Projects/Roadmap|Roadmap]] and [Design](Design.md).\n![Diagram](Assets/diagram.png)\n## Next\nMore links to [[Loose Wiki]].\n",
    })
    .addNote({ path: "Projects/Index.md", title: "Index", links: ["Projects/Plan.md"], content: "# Index\n[[Projects/Plan]]" });
}

describe("obsidian_retrieve mode=relationships", () => {
  it("returns a bounded explicit-note relationship summary with outgoing links and link impact", async () => {
    const backend = relationshipBackend();
    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Projects/Plan.md", budget: "standard", maxRelated: 10 });

    expect(result).toMatchObject({ tool: "obsidian_retrieve", status: "success", mode: "relationships", path: "Projects/Plan.md" });
    expect(result.relationshipSummary).toMatchObject({ outgoingIncluded: true, sectionsIncluded: false, backlinksIncluded: true, backlinkDataUnavailable: false });
    expect(result.outgoingWikiLinks.map((link: any) => link.raw)).toEqual(["Projects/Roadmap|Roadmap", "Loose Wiki"]);
    expect(result.outgoingMarkdownLinks.map((link: any) => link.target)).toEqual(["Design.md", "Assets/diagram.png"]);
    expect(result.relatedNotes.map((note: any) => note.path)).toEqual(expect.arrayContaining(["Design.md", "Projects/Index.md"]));
    expect(result.relatedNotes.map((note: any) => note.path)).not.toContain("Assets/diagram.png");
    expect(result.linkImpact).toMatchObject({ sourcePath: "Projects/Plan.md", linkRewriteSupported: false, hasOutgoingLinks: true });
    expect(JSON.stringify(result)).not.toContain("# Plan\nSee");
    expect(backend.readPaths()).toEqual(["Projects/Plan.md"]);
    expect(backend.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["files", "folders", "search", "searchContext"]));
  });

  it("is deterministic for repeated identical requests", async () => {
    const first = await obsidianRetrieve(relationshipBackend(), { mode: "relationships", path: "Projects/Plan.md", budget: "tiny", maxRelated: 2 });
    const second = await obsidianRetrieve(relationshipBackend(), { mode: "relationships", path: "Projects/Plan.md", budget: "tiny", maxRelated: 2 });
    expect(second).toEqual(first);
  });
});
