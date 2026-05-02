import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";

describe("relationship backlink handling", () => {
  it("uses safe bounded backlink fixtures when available", async () => {
    const backend = new FakeObsidianCliBackend()
      .addNote({ path: "Projects/Plan.md", title: "Plan", content: "# Plan" })
      .addNote({ path: "Projects/Index.md", title: "Index", content: "# Index", links: ["Projects/Plan.md"] });

    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Projects/Plan.md", includeBacklinks: true });
    expect(result.relationshipSummary).toMatchObject({ backlinkDataUnavailable: false, backlinksIncluded: true });
    expect(result.inboundReferences).toEqual([expect.objectContaining({ path: "Projects/Index.md", referenceType: "backend" })]);
    expect(backend.calls.map((call) => call.method)).toEqual(["read", "backlinks"]);
  });

  it("degrades safely when backlinks are unavailable and performs no broad scan", async () => {
    const backend = new FakeObsidianCliBackend().addNote({ path: "Projects/Plan.md", title: "Plan", content: "# Plan\n[[Other]]" });
    backend.backlinksAvailable = false;

    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Projects/Plan.md", includeBacklinks: true });
    expect(result.relationshipSummary).toMatchObject({ backlinkDataUnavailable: true, backlinksIncluded: false });
    expect(result.inboundReferences).toEqual([]);
    expect(result.degradedSignals).toContain("backlinks_unavailable");
    expect(result.warnings.join("\n")).toMatch(/no broad scan/i);
    expect(backend.calls.map((call) => call.method)).toEqual(["read", "backlinks"]);
  });
});
