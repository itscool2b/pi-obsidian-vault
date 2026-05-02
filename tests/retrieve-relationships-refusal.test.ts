import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";

describe("relationship validation refusals", () => {
  it("returns not_found for a safe missing Markdown note without leaking local details", async () => {
    const backend = new FakeObsidianCliBackend();
    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Projects/Missing.md" });
    expect(result.status).toBe("not_found");
    expect(result.path).toBe("Projects/Missing.md");
    expect(result.error.code).toBe("NOTE_NOT_FOUND");
    expect(result.outgoingMarkdownLinks).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/vaultRoot|lockKey|\/tmp\//i);
  });

  it("refuses multi-path and broad relationship request fields", async () => {
    const backend = new FakeObsidianCliBackend().addNote({ path: "Projects/Plan.md", title: "Plan", content: "# Plan" });
    const multi: any = await obsidianRetrieve(backend, { mode: "relationships", path: ["Projects/Plan.md", "Projects/Other.md"] as any });
    const scope: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Projects/Plan.md", scope: { folder: "Projects" } });
    const maxCandidates: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Projects/Plan.md", maxCandidates: 2 });
    expect([multi.status, scope.status, maxCandidates.status]).toEqual(["validation_error", "validation_error", "validation_error"]);
    expect(backend.calls).toEqual([]);
  });
});
