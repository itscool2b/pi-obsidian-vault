import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { seedNote, withTempVault } from "./write-test-utils.js";

describe("Obsidian tool boundaries", () => {
  it("keeps retrieval read-only when edit intent is present", async () => {
    const backend = seededFakeCli();
    const result = await obsidianRetrieve(backend, { query: "create and open a note about integrated gradients", mode: "search" });
    expect(result.warnings.join("\n")).toMatch(/read-only/i);
    const replaceIntent = await obsidianRetrieve(seededFakeCli(), { query: "replace exact text in integrated gradients", mode: "search" });
    expect(replaceIntent.warnings.join("\n")).toMatch(/read-only/i);
    expect(backend.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["write", "append", "edit", "delete", "rename", "move", "open"]));
  });

  it("keeps obsidian_write limited to create and append", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const operation of ["replace_section", "insert_under_heading", "update_frontmatter", "remove_frontmatter", "replace_exact_text", "overwrite", "delete", "rename", "move", "open"]) {
        const result = await obsidianWrite({ operation, path: "Notes/Target.md", content: "x", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
    });
  });

  it("keeps obsidian_edit from creating notes or accepting create/append/write operations", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Existing.md", "# Existing\n");
      for (const operation of ["create", "append", "write", "overwrite", "delete", "rename", "move", "open", "shell", "network", "scan", "regex_replace", "fuzzy_replace", "semantic_replace"]) {
        const result = await obsidianEdit({ operation, path: "Notes/Existing.md", content: "x", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
    });
  });
});
