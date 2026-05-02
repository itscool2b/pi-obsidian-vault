import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianValidate } from "../src/validation-engine.js";
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
    const folderIntent = await obsidianRetrieve(seededFakeCli(), { query: "create folder Projects/New Area", mode: "search" });
    expect(folderIntent.warnings.join("\n")).toMatch(/read-only/i);
    const moveIntent = await obsidianRetrieve(seededFakeCli(), { query: "move or rename integrated gradients note", mode: "search" });
    expect(moveIntent.warnings.join("\n")).toMatch(/read-only/i);
    const trashIntent = await obsidianRetrieve(seededFakeCli(), { query: "trash or delete integrated gradients note", mode: "search" });
    expect(trashIntent.warnings.join("\n")).toMatch(/read-only/i);
    const restoreIntent = await obsidianRetrieve(seededFakeCli(), { query: "restore integrated gradients note from trash", mode: "search" });
    expect(restoreIntent.warnings.join("\n")).toMatch(/read-only/i);
    const copyIntent = await obsidianRetrieve(seededFakeCli(), { query: "copy integrated gradients note", mode: "search" });
    expect(copyIntent.warnings.join("\n")).toMatch(/read-only/i);
    const noteIntent = await obsidianRetrieve(seededFakeCli(), { query: "delete note content", mode: "note", path: "Research/Integrated Gradients/index.md" });
    expect(noteIntent.warnings.join("\n")).toMatch(/read-only/i);
    expect(result.agentGuidance.nextActions.map((action) => action.action)).not.toEqual(expect.arrayContaining(["write", "open", "append", "delete", "trash", "restore", "copy", "rename", "move", "create_folder", "move_note", "trash_note", "restore_note", "copy_note"]));
    expect(backend.calls.map((call) => call.method)).not.toEqual(expect.arrayContaining(["write", "open", "append", "delete", "trash", "restore", "copy", "rename", "move", "create_folder", "move_note", "trash_note", "restore_note", "copy_note"]));
  });

  it("keeps validation advisory and refuses or ignores unsupported mutation/template intents without side effects", async () => {
    const backend = seededFakeCli();
    const unsafeWording = "# Plan\nCreate a template, generate a path, scan backlinks, rewrite links, open UI, run shell network command, create transaction preview, and use a commit token.";
    const proposed = await obsidianValidate(undefined, { target: "proposed_content", content: unsafeWording, expectedPath: "Projects/Plan.md" });
    expect(proposed.status).toBe("success");
    expect(proposed.valid).toBe(true);
    expect(proposed.issues.map((issue) => issue.code)).toContain("UNSAFE_OPERATION_WORDING");
    expect(backend.calls).toEqual([]);

    const existing = await obsidianValidate(backend, { target: "existing_note", path: "Research/Integrated Gradients/index.md" });
    expect(existing.status).toBe("success");
    expect(backend.calls.map((call) => call.method)).toEqual(["read"]);
    expect(existing.nextActions.map((action) => action.action)).not.toEqual(expect.arrayContaining(["create_from_template", "rewrite_links", "commit_token", "open", "shell", "network", "scan"]));
  });

  it("returns safety_refusal for forbidden write operations", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const operation of ["overwrite", "replace_exact_text", "delete", "trash", "trash_note", "restore_note", "copy_note", "rename", "move", "open", "shell", "network", "scan", "command", "delete_folder", "trash_folder", "rename_folder", "move_folder", "mkdir", "create_directory"]) {
        const result = await obsidianWrite({ operation, path: "Notes/Target.md", content: "replacement", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
    });
  });

  it("returns safety_refusal for forbidden edit operations", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const operation of ["create", "append", "overwrite", "delete", "trash", "trash_note", "restore_note", "copy_note", "rename", "move", "move_note", "open", "shell", "network", "scan", "command", "regex_replace", "fuzzy_replace", "semantic_replace"]) {
        const result = await obsidianEdit({ operation, path: "Notes/Target.md", content: "replacement", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
    });
  });

  it("returns safety_refusal for forbidden manage operations", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const operation of ["create", "append", "overwrite", "delete", "remove", "unlink", "trash", "recycle", "recursive_delete", "bulk_delete", "wildcard_delete", "recursive_restore", "bulk_restore", "wildcard_restore", "recursive_copy", "bulk_copy", "wildcard_copy", "rename", "move", "copy", "duplicate", "clone", "restore", "recover", "untrash", "open", "shell", "network", "scan", "command", "rewrite_links", "move_folder", "delete_folder", "trash_folder", "restore_folder", "copy_folder"]) {
        const result = await obsidianManage({ operation, fromPath: "Notes/Source.md", toPath: "Notes/Target.md", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
    });
  });
});
