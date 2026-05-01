import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { expectCopyPreviewUnchanged, expectNoLocalPathLeak, pathExists, readNote, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage copy_note dry-run previews", () => {
  it("previews a copy without creating the destination", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\nBody\n");
      await seedFolder(vaultRoot, "Archive");
      await seedNote(vaultRoot, "Archive/Other.md", "# Other\n");

      const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({
        tool: "obsidian_manage",
        status: "preview",
        operation: "copy_note",
        fromPath: "Projects/Plan.md",
        toPath: "Archive/Plan.md",
        dryRun: true,
        committed: false,
        target: {
          fromPath: "Projects/Plan.md",
          toPath: "Archive/Plan.md",
          targetKind: "markdown",
          sourceExistsBefore: true,
          sourceExistsAfter: true,
          destinationExistsBefore: false,
          destinationExistsAfter: false,
          parentExistsBefore: true,
          parentIsFolderBefore: true,
          wouldOverwrite: false,
          wouldCreateParent: false,
          wouldMoveSource: false,
          wouldDeleteSource: false,
          wouldRewriteLinks: false,
        },
        preview: {
          operation: "copy_note",
          fromPath: "Projects/Plan.md",
          toPath: "Archive/Plan.md",
          targetKind: "markdown",
          wouldCopy: true,
          wouldOverwrite: false,
          wouldCreateParent: false,
          wouldMoveSource: false,
          wouldDeleteSource: false,
          wouldRewriteLinks: false,
        },
      });
      expect(result.nextActions).toEqual(expect.arrayContaining([expect.objectContaining({ action: "confirm_preview", params: expect.objectContaining({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }) })]));
      await expectCopyPreviewUnchanged(vaultRoot, "Projects/Plan.md", "Archive/Plan.md", "# Plan\nBody\n");
      expect(await readNote(vaultRoot, "Archive/Other.md")).toBe("# Other\n");
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("previews an explicit same-folder copy to a new filename", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "same folder");

      const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Projects/Plan Copy.md" }, { vaultRoot });

      expect(result).toMatchObject({ status: "preview", operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Projects/Plan Copy.md", preview: { wouldCopy: true, wouldCreateParent: false } });
      await expectCopyPreviewUnchanged(vaultRoot, "Projects/Plan.md", "Projects/Plan Copy.md", "same folder");
    });
  });

  it("returns not_found for missing destination parent without creating it", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "missing parent");

      const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Missing/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({ status: "not_found", operation: "copy_note", committed: false, error: { code: "PARENT_MISSING", category: "not_found" } });
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Missing")).toBe(false);
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });
});
