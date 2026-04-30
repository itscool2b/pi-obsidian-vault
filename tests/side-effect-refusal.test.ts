import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { withTempVault } from "./write-test-utils.js";

describe("side-effect refusal", () => {
  it("returns read-only warnings and issues zero side-effect CLI commands", async () => {
    const backend = seededFakeCli();
    const result = await obsidianRetrieve(backend, { query: "create and open a note about integrated gradients", mode: "search" });
    expect(result.warnings.join("\n")).toMatch(/read-only/i);
    expect(result.agentGuidance.nextActions.map((action) => action.action)).not.toEqual(expect.arrayContaining(["write", "open", "append", "delete", "rename", "move"]));
    expect(backend.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["write", "open", "append", "delete", "rename", "move"]));
  });

  it("returns safety_refusal for forbidden write operations", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const operation of ["overwrite", "delete", "rename", "move", "open", "shell", "network", "scan", "command"]) {
        const result = await obsidianWrite({ operation, path: "Notes/Target.md", content: "replacement", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
    });
  });
});
