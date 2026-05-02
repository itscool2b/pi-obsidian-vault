import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";

const content = "# Plan\nIntro [[Overview]].\n## Alpha\nSee [A](A.md) and [[WikiA]].\n## Beta\nSee [B](B.md).\n";

describe("relationship section summaries", () => {
  it("omits section-level details by default", async () => {
    const backend = new FakeObsidianCliBackend().addNote({ path: "Projects/Plan.md", title: "Plan", content });
    backend.backlinksAvailable = false;
    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Projects/Plan.md" });
    expect(result.relationshipSummary.sectionsIncluded).toBe(false);
    expect(result.sectionRelationshipSummaries).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("## Alpha\nSee");
  });

  it("returns only tiny bounded deterministic redacted section relationship summaries when requested", async () => {
    const backend = new FakeObsidianCliBackend().addNote({ path: "Projects/Plan.md", title: "Plan", content });
    backend.backlinksAvailable = false;
    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Projects/Plan.md", includeSections: true, maxRelated: 2 });
    expect(result.relationshipSummary.sectionsIncluded).toBe(true);
    expect(result.sectionRelationshipSummaries.length).toBeLessThanOrEqual(2);
    expect(result.sectionRelationshipSummaries[0]).toMatchObject({ startLine: expect.any(Number), endLine: expect.any(Number), outgoingWikiLinkCount: expect.any(Number), outgoingMarkdownLinkCount: expect.any(Number), inboundReferenceCount: null });
    expect(JSON.stringify(result.sectionRelationshipSummaries)).not.toContain("See [A](A.md)");
    expect(backend.readPaths()).toEqual(["Projects/Plan.md"]);
  });
});
