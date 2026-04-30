import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { withTempVault } from "./write-test-utils.js";

describe("side-effect refusal", () => {
  it("returns read-only warnings and issues zero side-effect CLI commands", async () => {
    const backend = seededFakeCli();
    const result = await obsidianRetrieve(backend, { query: "create and open a note about integrated gradients", mode: "search" });
    expect(result.warnings.join("\n")).toMatch(/read-only/i);
    const replaceIntent = await obsidianRetrieve(seededFakeCli(), { query: "replace exact text in integrated gradients", mode: "search" });
    expect(replaceIntent.warnings.join("\n")).toMatch(/read-only/i);
    expect(result.agentGuidance.nextActions.map((action) => action.action)).not.toEqual(expect.arrayContaining(["write", "open", "append", "delete", "rename", "move"]));
    expect(backend.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["write", "open", "append", "delete", "rename", "move"]));
  });

  it("returns safety_refusal for forbidden write operations", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const operation of ["overwrite", "replace_exact_text", "delete", "rename", "move", "open", "shell", "network", "scan", "command"]) {
        const result = await obsidianWrite({ operation, path: "Notes/Target.md", content: "replacement", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
    });
  });

  it("returns safety_refusal for forbidden edit operations", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const operation of ["create", "append", "overwrite", "delete", "rename", "move", "open", "shell", "network", "scan", "command", "regex_replace", "fuzzy_replace", "semantic_replace"]) {
        const result = await obsidianEdit({ operation, path: "Notes/Target.md", content: "replacement", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
    });
  });
});
