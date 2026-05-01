import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { expectCopiedNote, expectNoLocalPathLeak, expectNoteUnchanged, pathExists, readNote, seedFile, seedFolder, seedNote, vaultSnapshot, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage copy_note filesystem behavior", () => {
  it("commits copy_note and preserves bytes while keeping the source", async () => {
    await withTempVault(async (vaultRoot) => {
      const content = "---\ntitle: Plan\n---\n# Plan\n\n[[Projects/Other]]\nUnicode: café 🚀\nTrailing spaces:   \n";
      await seedNote(vaultRoot, "Projects/Plan.md", content);
      await seedFolder(vaultRoot, "Archive");
      await seedNote(vaultRoot, "Projects/Other.md", "# Other\n");

      const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({
        status: "success",
        operation: "copy_note",
        fromPath: "Projects/Plan.md",
        toPath: "Archive/Plan.md",
        dryRun: false,
        committed: true,
        target: { sourceExistsBefore: true, sourceExistsAfter: true, destinationExistsBefore: false, destinationExistsAfter: true, wouldOverwrite: false, wouldCreateParent: false, wouldRewriteLinks: false, bytesPreserved: true },
      });
      await expectCopiedNote(vaultRoot, "Projects/Plan.md", "Archive/Plan.md", content);
      expect(await readNote(vaultRoot, "Projects/Other.md")).toBe("# Other\n");
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("commits same-folder and nested existing-parent copies without creating parents", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "same folder");
      await seedFolder(vaultRoot, "Archive/2026");
      const before = await vaultSnapshot(vaultRoot);

      const sameFolder = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Projects/Plan Copy.md", dryRun: false }, { vaultRoot });
      const nested = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/2026/Plan.md", dryRun: false }, { vaultRoot });

      expect(sameFolder).toMatchObject({ status: "success", committed: true });
      expect(nested).toMatchObject({ status: "success", committed: true });
      await expectCopiedNote(vaultRoot, "Projects/Plan.md", "Projects/Plan Copy.md", "same folder");
      await expectCopiedNote(vaultRoot, "Projects/Plan.md", "Archive/2026/Plan.md", "same folder");
      const after = await vaultSnapshot(vaultRoot);
      expect(after["Archive/"]).toBe(before["Archive/"]);
      expect(after["Archive/2026/"]).toBe(before["Archive/2026/"]);
      expect(await pathExists(vaultRoot, "Archive/Missing")).toBe(false);
    });
  });

  it("returns not_found for a missing source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFolder(vaultRoot, "Archive");
      const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Missing.md", toPath: "Archive/Missing.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "not_found", committed: false, error: { code: "SOURCE_NOT_FOUND", category: "not_found" } });
      expect(await pathExists(vaultRoot, "Archive/Missing.md")).toBe(false);
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("returns validation_error when source is a folder or non-regular file", async () => {
    await withTempVault(async (vaultRoot) => {
      await mkdir(path.join(vaultRoot, "Projects", "Folder.md"), { recursive: true });
      await seedNote(vaultRoot, "Projects/Target.md", "target");
      await seedFolder(vaultRoot, "Archive");
      await symlink("Target.md", path.join(vaultRoot, "Projects", "Link.md"));

      const folder = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Folder.md", toPath: "Archive/Folder.md", dryRun: false }, { vaultRoot });
      const link = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Link.md", toPath: "Archive/Link.md", dryRun: false }, { vaultRoot });

      expect(folder).toMatchObject({ status: "validation_error", committed: false, error: { code: "SOURCE_IS_FOLDER", category: "validation" } });
      expect(link).toMatchObject({ status: "validation_error", committed: false, error: { code: "SOURCE_NOT_FILE", category: "validation" } });
      expect(await pathExists(vaultRoot, "Archive/Folder.md")).toBe(false);
      expect(await pathExists(vaultRoot, "Archive/Link.md")).toBe(false);
    });
  });

  it("returns validation_error for non-Markdown source and destination and same paths", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFile(vaultRoot, "Projects/Plan.txt", "text");
      await seedNote(vaultRoot, "Projects/Plan.md", "same");
      await seedFolder(vaultRoot, "Archive");

      expect(await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.txt", toPath: "Archive/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "SOURCE_NOT_MARKDOWN", category: "validation" } });
      expect(await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.txt" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "TARGET_NOT_MARKDOWN", category: "validation" } });
      const same = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "@Projects/Plan.md" }, { vaultRoot });
      expect(same).toMatchObject({ status: "validation_error", committed: false, error: { code: "SAME_PATH", category: "validation" } });
      await expectNoteUnchanged(vaultRoot, "Projects/Plan.md", "same");
    });
  });

  it("returns conflict for existing destination without overwriting or auto-renaming", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      await seedNote(vaultRoot, "Archive/Plan.md", "existing");
      const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "TARGET_EXISTS", category: "conflict" } });
      await expectNoteUnchanged(vaultRoot, "Projects/Plan.md", "source");
      await expectNoteUnchanged(vaultRoot, "Archive/Plan.md", "existing");
      expect(await pathExists(vaultRoot, "Archive/Plan (1).md")).toBe(false);
    });
  });

  it("returns not_found for missing parent and conflict for parent file", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      expect(await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Missing/Plan.md", dryRun: false }, { vaultRoot })).toMatchObject({ status: "not_found", error: { code: "PARENT_MISSING" } });
      await seedFile(vaultRoot, "Blocked", "not a folder");
      const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Blocked/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "PARENT_NOT_FOLDER", category: "conflict" } });
      await expectNoteUnchanged(vaultRoot, "Projects/Plan.md", "source");
      expect(await readNote(vaultRoot, "Blocked")).toBe("not a folder");
    });
  });
});
