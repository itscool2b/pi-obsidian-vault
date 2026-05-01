import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { expectNoLocalPathLeak, expectPathMissing, expectTrashTarget, pathExists, readNote, seedFile, seedFolder, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage trash_note filesystem behavior", () => {
  it("commits trash_note to default _Trash, creates the folder, and preserves content", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\nBody\n");
      await seedNote(vaultRoot, "Projects/Other.md", "# Other\n");

      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({
        status: "success",
        operation: "trash_note",
        path: "Projects/Plan.md",
        trashFolder: "_Trash",
        trashPath: "_Trash/Plan.md",
        dryRun: false,
        committed: true,
        target: { sourceExistsBefore: true, sourceExistsAfter: false, trashFolderExistsBefore: false, trashFolderExistsAfter: true, trashFolderCreated: true, trashTargetExistsBefore: false, trashTargetExistsAfter: true },
      });
      await expectPathMissing(vaultRoot, "Projects/Plan.md");
      await expectTrashTarget(vaultRoot, "_Trash/Plan.md", "# Plan\nBody\n");
      expect(await readNote(vaultRoot, "Projects/Other.md")).toBe("# Other\n");
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("commits trash_note to an explicit existing safe trashFolder", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "explicit");
      await seedFolder(vaultRoot, "Archive/Trash");

      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md", trashFolder: "Archive/Trash", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({ status: "success", trashFolder: "Archive/Trash", trashPath: "Archive/Trash/Plan.md", target: { trashFolderDefaulted: false, trashFolderExistsBefore: true, trashFolderCreated: false } });
      await expectPathMissing(vaultRoot, "Projects/Plan.md");
      await expectTrashTarget(vaultRoot, "Archive/Trash/Plan.md", "explicit");
    });
  });

  it("commits trash_note by creating a missing nested safe trashFolder", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "nested");

      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md", trashFolder: "Archive/Trash", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({ status: "success", trashPath: "Archive/Trash/Plan.md", target: { trashFolderExistsBefore: false, trashFolderCreated: true } });
      await expectTrashTarget(vaultRoot, "Archive/Trash/Plan.md", "nested");
      expect(await pathExists(vaultRoot, "Archive/Trash/Projects/Plan.md")).toBe(false);
    });
  });

  it("returns not_found for missing source without creating trash folder", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Missing.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "not_found", committed: false, error: { code: "SOURCE_NOT_FOUND", category: "not_found" } });
      expect(await pathExists(vaultRoot, "_Trash")).toBe(false);
      expect(await pathExists(vaultRoot, "_Trash/Missing.md")).toBe(false);
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("returns validation_error for non-Markdown source without mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFile(vaultRoot, "Projects/Plan.txt", "text");
      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.txt", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "validation_error", committed: false, error: { code: "SOURCE_NOT_MARKDOWN", category: "validation" } });
      expect(await readNote(vaultRoot, "Projects/Plan.txt")).toBe("text");
      expect(await pathExists(vaultRoot, "_Trash")).toBe(false);
    });
  });

  it("returns safety_refusal when source path is a folder and does not move it", async () => {
    await withTempVault(async (vaultRoot) => {
      await mkdir(path.join(vaultRoot, "Projects", "Folder.md"), { recursive: true });
      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Folder.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "SOURCE_IS_FOLDER", category: "safety" } });
      expect(await pathExists(vaultRoot, "Projects/Folder.md")).toBe(true);
      expect(await pathExists(vaultRoot, "_Trash/Folder.md")).toBe(false);
    });
  });

  it("returns conflict when trash folder path exists as a file", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      await seedFile(vaultRoot, "_Trash", "not a folder");
      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "TRASH_FOLDER_NOT_FOLDER", category: "conflict" } });
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe("source");
      expect(await readNote(vaultRoot, "_Trash")).toBe("not a folder");
    });
  });

  it("returns conflict for default trash target collision without overwriting or auto-renaming", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      await seedNote(vaultRoot, "_Trash/Plan.md", "existing");
      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "TRASH_TARGET_EXISTS", category: "conflict" } });
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe("source");
      expect(await readNote(vaultRoot, "_Trash/Plan.md")).toBe("existing");
      expect(await pathExists(vaultRoot, "_Trash/Plan (1).md")).toBe(false);
    });
  });

  it("returns conflict for explicit trashFolder collision without overwriting or auto-renaming", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      await seedNote(vaultRoot, "Archive/Trash/Plan.md", "existing");
      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md", trashFolder: "Archive/Trash", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "TRASH_TARGET_EXISTS" }, trashPath: "Archive/Trash/Plan.md" });
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe("source");
      expect(await readNote(vaultRoot, "Archive/Trash/Plan.md")).toBe("existing");
      expect(await pathExists(vaultRoot, "Archive/Trash/Plan (1).md")).toBe(false);
    });
  });
});
