import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { expectNoLocalPathLeak, folderExists, pathExists, readNote, seedFolder, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage trash_note dry-run previews", () => {
  it("previews safe note trash by default without moving or creating _Trash", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");

      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({
        tool: "obsidian_manage",
        status: "preview",
        operation: "trash_note",
        path: "Projects/Plan.md",
        trashFolder: "_Trash",
        trashPath: "_Trash/Plan.md",
        dryRun: true,
        committed: false,
        target: {
          path: "Projects/Plan.md",
          trashFolder: "_Trash",
          trashPath: "_Trash/Plan.md",
          targetKind: "markdown",
          trashFolderDefaulted: true,
          sourceExistsBefore: true,
          sourceExistsAfter: true,
          trashFolderExistsBefore: false,
          trashFolderExistsAfter: false,
          trashFolderWouldBeCreated: true,
          trashTargetExistsBefore: false,
          trashTargetExistsAfter: false,
          wouldOverwrite: false,
          wouldPermanentlyDelete: false,
          wouldRewriteLinks: false,
        },
        preview: {
          operation: "trash_note",
          path: "Projects/Plan.md",
          trashFolder: "_Trash",
          trashPath: "_Trash/Plan.md",
          targetKind: "markdown",
          wouldTrash: true,
          wouldCreateTrashFolder: true,
          wouldOverwrite: false,
          wouldPermanentlyDelete: false,
          wouldRewriteLinks: false,
        },
      });
      expect(result.message).toContain("Projects/Plan.md");
      expect(result.message).toContain("_Trash/Plan.md");
      expect(result.nextActions.map((action) => action.action)).toContain("confirm_preview");
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe("# Plan\n");
      expect(await folderExists(vaultRoot, "_Trash")).toBe(false);
      expect(await pathExists(vaultRoot, "_Trash/Plan.md")).toBe(false);
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("previews explicit safe trashFolder without mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      await seedFolder(vaultRoot, "Archive/Trash");

      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md", trashFolder: "Archive/Trash" }, { vaultRoot });

      expect(result).toMatchObject({
        status: "preview",
        operation: "trash_note",
        path: "Projects/Plan.md",
        trashFolder: "Archive/Trash",
        trashPath: "Archive/Trash/Plan.md",
        dryRun: true,
        committed: false,
        target: { trashFolderDefaulted: false, trashFolderExistsBefore: true, trashFolderWouldBeCreated: false },
        preview: { wouldTrash: true, wouldCreateTrashFolder: false },
      });
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Archive/Trash/Plan.md")).toBe(false);
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });
});
