import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { expectNoLocalPathLeak, expectRestorePreviewUnchanged, folderExists, pathExists, readNote, seedFolder, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage restore_note dry-run previews", () => {
  it("previews a default _Trash restore without moving the note", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "# Plan\nBody\n");
      await seedFolder(vaultRoot, "Projects");
      await seedNote(vaultRoot, "Projects/Other.md", "# Other\n");

      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({
        tool: "obsidian_manage",
        status: "preview",
        operation: "restore_note",
        trashPath: "_Trash/Plan.md",
        toPath: "Projects/Plan.md",
        trashFolder: "_Trash",
        dryRun: true,
        committed: false,
        target: {
          trashPath: "_Trash/Plan.md",
          toPath: "Projects/Plan.md",
          trashFolder: "_Trash",
          targetKind: "markdown",
          trashFolderDefaulted: true,
          trashSourceExistsBefore: true,
          trashSourceExistsAfter: true,
          destinationExistsBefore: false,
          destinationExistsAfter: false,
          parentExistsBefore: true,
          parentIsFolderBefore: true,
          wouldOverwrite: false,
          wouldCreateParent: false,
          wouldPermanentlyDelete: false,
          wouldRewriteLinks: false,
        },
        preview: {
          operation: "restore_note",
          trashPath: "_Trash/Plan.md",
          toPath: "Projects/Plan.md",
          trashFolder: "_Trash",
          targetKind: "markdown",
          wouldRestore: true,
          wouldOverwrite: false,
          wouldCreateParent: false,
          wouldPermanentlyDelete: false,
          wouldRewriteLinks: false,
        },
      });
      expect(result.nextActions).toEqual(expect.arrayContaining([expect.objectContaining({ action: "confirm_preview", params: expect.objectContaining({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", trashFolder: "_Trash", dryRun: false }) })]));
      await expectRestorePreviewUnchanged(vaultRoot, "_Trash/Plan.md", "Projects/Plan.md", "# Plan\nBody\n");
      expect(await readNote(vaultRoot, "Projects/Other.md")).toBe("# Other\n");
      expect(await folderExists(vaultRoot, "_Trash")).toBe(true);
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("previews an explicit safe trashFolder restore without mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Archive/Trash/Plan.md", "explicit");
      await seedFolder(vaultRoot, "Projects");

      const result = await obsidianManage({ operation: "restore_note", trashPath: "Archive/Trash/Plan.md", toPath: "Projects/Plan.md", trashFolder: "Archive/Trash" }, { vaultRoot });

      expect(result).toMatchObject({
        status: "preview",
        operation: "restore_note",
        trashPath: "Archive/Trash/Plan.md",
        toPath: "Projects/Plan.md",
        trashFolder: "Archive/Trash",
        dryRun: true,
        committed: false,
        target: { trashFolderDefaulted: false, trashSourceExistsBefore: true, destinationExistsBefore: false },
        preview: { wouldRestore: true, wouldCreateParent: false, wouldOverwrite: false },
      });
      await expectRestorePreviewUnchanged(vaultRoot, "Archive/Trash/Plan.md", "Projects/Plan.md", "explicit");
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("returns not_found for missing destination parent without creating it", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "missing parent");

      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Missing/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({ status: "not_found", operation: "restore_note", committed: false, error: { code: "PARENT_MISSING", category: "not_found" } });
      expect(await pathExists(vaultRoot, "_Trash/Plan.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Missing")).toBe(false);
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });
});
