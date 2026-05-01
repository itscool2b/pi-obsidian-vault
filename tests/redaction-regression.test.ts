import path from "node:path";
import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { expectNoSensitivePathLeak, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

function assertNoLeakedPaths(value: unknown, vaultRoot: string, extra: string[] = []): void {
  expectNoSensitivePathLeak(value, [vaultRoot, path.join(vaultRoot, "Notes", "Absolute.md"), ...extra]);
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/\/tmp\/pi-obsidian-write-/);
  expect(text).not.toMatch(/[A-Za-z]:\\\\Users\\\\me/);
}

describe("release redaction regression", () => {
  it("keeps write previews, successes, validation errors, safety refusals, conflicts, warnings, and next actions redacted", async () => {
    await withTempVault(async (vaultRoot) => {
      const preview = await obsidianWrite({ operation: "create", path: "Notes/Preview.md", content: "# Preview" }, { vaultRoot });
      const success = await obsidianWrite({ operation: "create", path: "Notes/Created.md", content: "# Created", dryRun: false }, { vaultRoot });
      const validation = await obsidianWrite({ operation: "create_folder", path: "Folders/No Content", content: "not allowed", dryRun: false }, { vaultRoot });
      const safety = await obsidianWrite({ operation: "create", path: "/tmp/outside.md", content: "x", dryRun: false }, { vaultRoot });
      const conflict = await obsidianWrite({ operation: "create", path: "Notes/Created.md", content: "# Replacement", dryRun: false }, { vaultRoot });
      for (const result of [preview, success, validation, safety, conflict]) {
        assertNoLeakedPaths(result, vaultRoot, ["/tmp/outside.md"]);
        expect(JSON.stringify(result.nextActions)).not.toContain(vaultRoot);
        expect(JSON.stringify(result.warnings)).not.toContain(vaultRoot);
      }
    });
  });

  it("keeps edit previews, successes, validation errors, safety refusals, conflicts, warnings, and next actions redacted", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Edit.md", "# Edit\n\n## Section\nOld\n");
      const preview = await obsidianEdit({ operation: "replace_section", path: "Notes/Edit.md", heading: "## Section", content: "New" }, { vaultRoot });
      const success = await obsidianEdit({ operation: "replace_exact_text", path: "Notes/Edit.md", oldText: "Old", newText: "New", dryRun: false }, { vaultRoot });
      const validation = await obsidianEdit({ operation: "replace_section", path: "Notes/Edit.md", heading: "not a heading", content: "x", dryRun: false }, { vaultRoot });
      const safety = await obsidianEdit({ operation: "replace_exact_text", path: "C:\\Users\\me\\outside.md", oldText: "x", newText: "y", dryRun: false }, { vaultRoot });
      const conflictLike = await obsidianEdit({ operation: "replace_exact_text", path: "Notes/Edit.md", oldText: "missing", newText: "x", dryRun: false }, { vaultRoot });
      for (const result of [preview, success, validation, safety, conflictLike]) {
        assertNoLeakedPaths(result, vaultRoot, ["C:\\Users\\me\\outside.md"]);
        expect(JSON.stringify(result.nextActions)).not.toContain(vaultRoot);
        expect(JSON.stringify(result.warnings)).not.toContain(vaultRoot);
      }
    });
  });

  it("keeps manage previews, successes, validation errors, safety refusals, conflicts, warnings, and next actions redacted", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Move/Source.md", "move");
      await seedFolder(vaultRoot, "Archive");
      const preview = await obsidianManage({ operation: "move_note", fromPath: "Move/Source.md", toPath: "Archive/Source.md" }, { vaultRoot });
      const success = await obsidianManage({ operation: "move_note", fromPath: "Move/Source.md", toPath: "Archive/Source.md", dryRun: false }, { vaultRoot });
      const validation = await obsidianManage({ operation: "move_note", fromPath: "Archive/Source.md", toPath: "@Archive/Source.md" }, { vaultRoot });
      const safety = await obsidianManage({ operation: "move_note", fromPath: "../outside.md", toPath: "Archive/Outside.md", dryRun: false }, { vaultRoot });
      const conflict = await obsidianManage({ operation: "move_note", fromPath: "Archive/Source.md", toPath: "Archive/Source.md", dryRun: false }, { vaultRoot });
      await seedNote(vaultRoot, "Trash/Plan.md", "trash");
      const trashPreview = await obsidianManage({ operation: "trash_note", path: "Trash/Plan.md" }, { vaultRoot });
      const trashSuccess = await obsidianManage({ operation: "trash_note", path: "Trash/Plan.md", dryRun: false }, { vaultRoot });
      await seedNote(vaultRoot, "_Trash/Restore.md", "restore");
      const restorePreview = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Restore.md", toPath: "Archive/Restore.md" }, { vaultRoot });
      const restoreSuccess = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Restore.md", toPath: "Archive/Restore.md", dryRun: false }, { vaultRoot });
      await seedNote(vaultRoot, "_Trash/Conflict.md", "conflict");
      const restoreValidation = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Restore.txt", toPath: "Archive/Restore.md" }, { vaultRoot });
      const restoreSafety = await obsidianManage({ operation: "restore_note", trashPath: "OtherTrash/Restore.md", toPath: "Archive/Restore2.md" }, { vaultRoot });
      const restoreConflict = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Conflict.md", toPath: "Archive/Restore.md" }, { vaultRoot });
      const restoreNotFound = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Missing.md", toPath: "Archive/Missing.md" }, { vaultRoot });
      await seedNote(vaultRoot, "Copy/Source.md", "copy");
      const copyPreview = await obsidianManage({ operation: "copy_note", fromPath: "Copy/Source.md", toPath: "Archive/Copy.md" }, { vaultRoot });
      const copySuccess = await obsidianManage({ operation: "copy_note", fromPath: "Copy/Source.md", toPath: "Archive/Copy.md", dryRun: false }, { vaultRoot });
      const copyValidation = await obsidianManage({ operation: "copy_note", fromPath: "Copy/Source.txt", toPath: "Archive/Copy2.md" }, { vaultRoot });
      const copySafety = await obsidianManage({ operation: "copy_note", fromPath: "../outside.md", toPath: "Archive/Copy3.md" }, { vaultRoot });
      const copyConflict = await obsidianManage({ operation: "copy_note", fromPath: "Copy/Source.md", toPath: "Archive/Copy.md" }, { vaultRoot });
      const copyNotFound = await obsidianManage({ operation: "copy_note", fromPath: "Copy/Missing.md", toPath: "Archive/MissingCopy.md" }, { vaultRoot });
      for (const result of [preview, success, validation, safety, conflict, trashPreview, trashSuccess, restorePreview, restoreSuccess, restoreValidation, restoreSafety, restoreConflict, restoreNotFound, copyPreview, copySuccess, copyValidation, copySafety, copyConflict, copyNotFound]) {
        assertNoLeakedPaths(result, vaultRoot, ["../outside.md"]);
        expect(JSON.stringify(result.nextActions)).not.toContain(vaultRoot);
        expect(JSON.stringify(result.warnings)).not.toContain(vaultRoot);
      }
    });
  });

  it("does not echo raw unsafe absolute or traversal paths in unsafe path refusals", async () => {
    await withTempVault(async (vaultRoot) => {
      const unsafeValues = ["/tmp/outside.md", "C:\\Users\\me\\outside.md", "../outside.md", "Folder/%2e%2e/outside.md"];
      for (const unsafe of unsafeValues) {
        const write = await obsidianWrite({ operation: "create", path: unsafe, content: "x", dryRun: false }, { vaultRoot });
        const edit = await obsidianEdit({ operation: "update_frontmatter", path: unsafe, property: "status", value: "x", dryRun: false }, { vaultRoot });
        const manage = await obsidianManage({ operation: "trash_note", path: unsafe, dryRun: false }, { vaultRoot });
        const restore = await obsidianManage({ operation: "restore_note", trashPath: unsafe, toPath: "Notes/Restored.md", dryRun: false }, { vaultRoot });
        const copy = await obsidianManage({ operation: "copy_note", fromPath: unsafe, toPath: "Notes/Copied.md", dryRun: false }, { vaultRoot });
        for (const result of [write, edit, manage, restore, copy]) {
          expect(result.committed).toBe(false);
          assertNoLeakedPaths(result, vaultRoot, [unsafe]);
        }
      }
    });
  });
});
