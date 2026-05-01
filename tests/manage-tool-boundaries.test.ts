import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { pathExists, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage tool boundaries", () => {
  it("keeps retrieval read-only for move and rename intent", async () => {
    const backend = seededFakeCli();
    const result = await obsidianRetrieve(backend, { query: "move or rename a note in obsidian", mode: "search" });
    expect(result.warnings.join("\n")).toMatch(/read-only/i);
    expect(backend.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["write", "append", "edit", "delete", "rename", "move", "open"]));
  });

  it("keeps obsidian_write and obsidian_edit from accepting move_note", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Existing.md", "# Existing\n");
      const write = await obsidianWrite({ operation: "move_note", path: "Notes/Existing.md", content: "x", dryRun: false }, { vaultRoot });
      expect(write).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });

      const edit = await obsidianEdit({ operation: "move_note", path: "Notes/Existing.md", content: "x", dryRun: false }, { vaultRoot });
      expect(edit).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
    });
  });

  it("refuses unsupported and forbidden management actions without side effects", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      for (const operation of ["rename", "move", "copy", "delete", "overwrite", "rewrite_links", "move_folder", "create", "append", "replace_exact_text", "open", "shell", "network", "scan", "discover", "command"]) {
        const result = await obsidianManage({ operation, fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Archive/Plan.md")).toBe(false);
    });
  });
});
