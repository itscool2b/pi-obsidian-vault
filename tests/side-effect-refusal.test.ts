import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("side-effect refusal", () => {
  it("returns read-only warnings and issues zero side-effect CLI commands", async () => {
    const backend = seededFakeCli();
    const result = await obsidianRetrieve(backend, { query: "create and open a note about integrated gradients", mode: "search" });
    expect(result.warnings.join("\n")).toMatch(/read-only/i);
    expect(backend.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["write", "open", "append", "delete", "rename", "move"]));
  });
});
