import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";

describe("relationship budget and maxRelated limits", () => {
  it("clips relationship arrays deterministically and reports truncation", async () => {
    const links = Array.from({ length: 8 }, (_, index) => `Notes/${index}.md`);
    const backend = new FakeObsidianCliBackend().addNote({
      path: "Notes/Hub.md",
      title: "Hub",
      links,
      content: `# Hub\n${links.map((link) => `[${link}](${link})`).join("\n")}`,
    });
    for (const link of links) backend.addNote({ path: link, title: link, content: `# ${link}`, links: ["Notes/Hub.md"] });

    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Notes/Hub.md", budget: "expanded", maxRelated: 3 });
    expect(result.outgoingMarkdownLinks).toHaveLength(3);
    expect(result.inboundReferences).toHaveLength(3);
    expect(result.relatedNotes.length).toBeLessThanOrEqual(3);
    expect(result.relationshipSummary.relationshipDataTruncated).toBe(true);
    expect(result.degradedSignals).toEqual(expect.arrayContaining(["relationships_limited", "budget"]));
  });

  it("rejects invalid maxRelated values before reading", async () => {
    const backend = new FakeObsidianCliBackend().addNote({ path: "Notes/Hub.md", title: "Hub", content: "# Hub" });
    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Notes/Hub.md", maxRelated: 0 });
    expect(result.status).toBe("validation_error");
    expect(result.error.code).toBe("INVALID_MAX_RELATED");
    expect(backend.calls).toEqual([]);
  });
});
