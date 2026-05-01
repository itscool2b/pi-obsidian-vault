import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { expectNoLocalPathLeak, expectNoteUnchanged, expectPathMissing, expectRestoredNote, pathExists, readNote, seedFile, seedFolder, seedNote, stringifyDetails, vaultSnapshot, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage restore_note filesystem behavior", () => {
  it("commits restore_note from default _Trash and preserves content", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "# Plan\nBody\n");
      await seedFolder(vaultRoot, "Projects");
      await seedNote(vaultRoot, "Projects/Other.md", "# Other\n");

      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({
        status: "success",
        operation: "restore_note",
        trashPath: "_Trash/Plan.md",
        toPath: "Projects/Plan.md",
        trashFolder: "_Trash",
        dryRun: false,
        committed: true,
        target: { trashSourceExistsBefore: true, trashSourceExistsAfter: false, destinationExistsBefore: false, destinationExistsAfter: true, wouldOverwrite: false, wouldCreateParent: false },
      });
      await expectRestoredNote(vaultRoot, "_Trash/Plan.md", "Projects/Plan.md", "# Plan\nBody\n");
      expect(await readNote(vaultRoot, "Projects/Other.md")).toBe("# Other\n");
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("commits restore_note from an explicit trashFolder and does not create parents", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Archive/Trash/Plan.md", "explicit");
      await seedFolder(vaultRoot, "Projects");
      const before = await vaultSnapshot(vaultRoot);

      const result = await obsidianManage({ operation: "restore_note", trashPath: "Archive/Trash/Plan.md", toPath: "Projects/Plan.md", trashFolder: "Archive/Trash", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({ status: "success", trashFolder: "Archive/Trash", target: { trashFolderDefaulted: false } });
      await expectRestoredNote(vaultRoot, "Archive/Trash/Plan.md", "Projects/Plan.md", "explicit");
      const after = await vaultSnapshot(vaultRoot);
      expect(after["Archive/Trash/"]).toBe("<dir>");
      expect(after["Projects/"]).toBe(before["Projects/"]);
      expect(after["Projects/Plan.md"]).toBe("explicit");
    });
  });

  it("revalidates containment at commit time", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "inside");
      await seedFolder(vaultRoot, "Projects");

      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", trashFolder: "Archive/Trash", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "TRASH_PATH_OUTSIDE_TRASH", category: "safety" } });
      await expectNoteUnchanged(vaultRoot, "_Trash/Plan.md", "inside");
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(false);
    });
  });

  it("returns not_found for a missing trash source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFolder(vaultRoot, "Projects");
      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Missing.md", toPath: "Projects/Missing.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "not_found", committed: false, error: { code: "TRASH_SOURCE_NOT_FOUND", category: "not_found" } });
      expect(await pathExists(vaultRoot, "Projects/Missing.md")).toBe(false);
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("refuses a trashPath outside the selected trashFolder", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "OtherTrash/Plan.md", "outside");
      await seedFolder(vaultRoot, "Projects");
      const result = await obsidianManage({ operation: "restore_note", trashPath: "OtherTrash/Plan.md", toPath: "Projects/Plan.md" }, { vaultRoot });
      expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "TRASH_PATH_OUTSIDE_TRASH", category: "safety" } });
      await expectNoteUnchanged(vaultRoot, "OtherTrash/Plan.md", "outside");
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(false);
    });
  });

  it("returns safety_refusal when trash source is a folder", async () => {
    await withTempVault(async (vaultRoot) => {
      await mkdir(path.join(vaultRoot, "_Trash", "Folder.md"), { recursive: true });
      await seedFolder(vaultRoot, "Projects");
      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Folder.md", toPath: "Projects/Folder.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "TRASH_SOURCE_IS_FOLDER", category: "safety" } });
      expect(await pathExists(vaultRoot, "_Trash/Folder.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Projects/Folder.md")).toBe(false);
    });
  });

  it("returns safety_refusal when trash source is not a regular file", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Target.md", "target");
      await seedFolder(vaultRoot, "Projects");
      await symlink("Target.md", path.join(vaultRoot, "_Trash", "Link.md"));
      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Link.md", toPath: "Projects/Link.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "TRASH_SOURCE_NOT_FILE", category: "safety" } });
      expect(await pathExists(vaultRoot, "_Trash/Link.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Projects/Link.md")).toBe(false);
    });
  });

  it("returns validation_error for non-Markdown trashPath and destination", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFile(vaultRoot, "_Trash/Plan.txt", "text");
      await seedFolder(vaultRoot, "Projects");
      expect(await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.txt", toPath: "Projects/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "TRASH_SOURCE_NOT_MARKDOWN", category: "validation" } });
      expect(await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.txt" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "TARGET_NOT_MARKDOWN", category: "validation" } });
      expect(await readNote(vaultRoot, "_Trash/Plan.txt")).toBe("text");
    });
  });

  it("returns validation_error for same normalized trashPath and toPath", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "same");
      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "_Trash/Plan.md" }, { vaultRoot });
      expect(result).toMatchObject({ status: "validation_error", committed: false, error: { code: "SAME_PATH", category: "validation" } });
      await expectNoteUnchanged(vaultRoot, "_Trash/Plan.md", "same");
    });
  });

  it("returns conflict for existing destination without overwriting or auto-renaming", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "source");
      await seedNote(vaultRoot, "Projects/Plan.md", "existing");
      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "TARGET_EXISTS", category: "conflict" } });
      await expectNoteUnchanged(vaultRoot, "_Trash/Plan.md", "source");
      await expectNoteUnchanged(vaultRoot, "Projects/Plan.md", "existing");
      expect(await pathExists(vaultRoot, "Projects/Plan (1).md")).toBe(false);
    });
  });

  it("returns not_found for missing parent and conflict for parent file", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "source");
      expect(await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Missing/Plan.md", dryRun: false }, { vaultRoot })).toMatchObject({ status: "not_found", error: { code: "PARENT_MISSING" } });
      await seedFile(vaultRoot, "Blocked", "not a folder");
      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Blocked/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "PARENT_NOT_FOLDER", category: "conflict" } });
      await expectNoteUnchanged(vaultRoot, "_Trash/Plan.md", "source");
      expect(await readNote(vaultRoot, "Blocked")).toBe("not a folder");
    });
  });

  it("returns conflict when selected trashFolder is a file", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFile(vaultRoot, "_Trash", "not a folder");
      await seedFolder(vaultRoot, "Projects");
      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "TRASH_FOLDER_NOT_FOLDER", category: "conflict" } });
      expect(await readNote(vaultRoot, "_Trash")).toBe("not a folder");
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });
});
