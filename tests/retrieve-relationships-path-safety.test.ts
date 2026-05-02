import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";
import { UNSAFE_NOTE_PATHS } from "./release-hardening-fixtures.js";

describe("relationship path safety", () => {
  it("refuses unsafe relationship paths before reading", async () => {
    for (const unsafe of UNSAFE_NOTE_PATHS) {
      const backend = new FakeObsidianCliBackend().addNote({ path: "Notes/Safe.md", title: "Safe", content: "# Safe" });
      const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: unsafe });
      expect(["safety_refusal", "validation_error"]).toContain(result.status);
      expect(result.outgoingWikiLinks).toEqual([]);
      expect(result.inboundReferences).toEqual([]);
      expect(backend.calls).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(unsafe.trim() && unsafe.startsWith("/") ? unsafe : "C:\\Users\\me\\outside.md");
    }
  });

  it("rejects broad request shapes and selected-set relationship attempts", async () => {
    const backend = new FakeObsidianCliBackend().addNote({ path: "Notes/Safe.md", title: "Safe", content: "# Safe" });
    const result: any = await obsidianRetrieve(backend, { mode: "relationships", path: "Notes/Safe.md", selected: [{ path: "Other.md" }] });
    expect(result.status).toBe("validation_error");
    expect(result.error.code).toBe("UNSUPPORTED_RELATIONSHIP_FIELD");
    expect(backend.calls).toEqual([]);
  });
});
