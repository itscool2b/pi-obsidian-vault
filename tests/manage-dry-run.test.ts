import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { pathExists, readNote, seedFolder, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage dry-run previews", () => {
  it("previews safe note moves by default without mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      await seedFolder(vaultRoot, "Archive");

      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({
        tool: "obsidian_manage",
        status: "preview",
        operation: "move_note",
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
          movedToDifferentFolder: true,
        },
        preview: {
          operation: "move_note",
          fromPath: "Projects/Plan.md",
          toPath: "Archive/Plan.md",
          targetKind: "markdown",
          wouldMove: true,
          wouldChangeParent: true,
          wouldOverwrite: false,
          wouldRewriteLinks: false,
        },
      });
      expect(result.message).toContain("Projects/Plan.md");
      expect(result.message).toContain("Archive/Plan.md");
      expect(result.nextActions.map((action) => action.action)).toContain("confirm_preview");
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe("# Plan\n");
      expect(await pathExists(vaultRoot, "Archive/Plan.md")).toBe(false);
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("previews same-folder renames without moving the source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");

      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Projects/Roadmap.md" }, { vaultRoot });

      expect(result).toMatchObject({
        status: "preview",
        dryRun: true,
        committed: false,
        target: { renamedWithinFolder: true, movedToDifferentFolder: false },
        preview: { wouldMove: true, wouldRename: true, wouldChangeParent: false },
      });
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Projects/Roadmap.md")).toBe(false);
    });
  });
});
