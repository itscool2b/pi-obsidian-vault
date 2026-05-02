import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend, unexpectedFakeCliSideEffectCalls } from "./fake-obsidian-cli.js";

describe("relationship no-dump and no-scan safety", () => {
  it("does not return full note content or recursive relationship expansion", async () => {
    const backend = new FakeObsidianCliBackend()
      .addNote({ path: "Notes/A.md", title: "A", content: "# A\nSecret full body should not appear.\n[Next](Notes/B.md)", links: ["Notes/B.md"] })
      .addNote({ path: "Notes/B.md", title: "B", content: "# B\nRecursive target body must not be read.", links: ["Notes/C.md"] })
      .addNote({ path: "Notes/C.md", title: "C", content: "# C" });

    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Notes/A.md", includeBacklinks: false, includeSections: true });
    const text = JSON.stringify(result);
    expect(text).not.toContain("Secret full body should not appear");
    expect(text).not.toContain("Recursive target body must not be read");
    expect(backend.readPaths()).toEqual(["Notes/A.md"]);
    expect(backend.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["files", "folders", "search", "searchContext", "links"]));
    expect(unexpectedFakeCliSideEffectCalls(backend)).toEqual([]);
  });
});
