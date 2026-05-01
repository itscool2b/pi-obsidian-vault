import { describe, expect, it } from "vitest";
import { obsidianWrite } from "../src/write-engine.js";
import { expectFolderMissing, folderExists, pathExists, seedFile, seedFolder, stringifyDetails, withTempVault } from "./write-test-utils.js";

describe("obsidian_write create_folder", () => {
  it("previews safe folder creation by default without mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "create_folder", path: "Projects/New Area" }, { vaultRoot });
      expect(result).toMatchObject({
        tool: "obsidian_write",
        status: "preview",
        operation: "create_folder",
        path: "Projects/New Area",
        dryRun: true,
        committed: false,
        target: { path: "Projects/New Area", targetKind: "folder", existsBefore: false, folderExistsBefore: false, parentExistsBefore: false },
        preview: { operation: "create_folder", path: "Projects/New Area", targetKind: "folder", wouldCreate: true, wouldAppend: false, wouldCreateFolder: true, wouldCreateParentDirectories: true, alreadyExists: false },
      });
      expect(result.message).toContain("Projects/New Area");
      expect(result.nextActions.map((action) => action.action)).toContain("confirm_preview");
      await expectFolderMissing(vaultRoot, "Projects/New Area");
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("previews nested safe parent folder creation without creating parents", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "create_folder", path: "Projects/Parent/Child" }, { vaultRoot });
      expect(result).toMatchObject({ status: "preview", preview: { wouldCreateFolder: true, wouldCreateParentDirectories: true }, committed: false });
      await expectFolderMissing(vaultRoot, "Projects");
      await expectFolderMissing(vaultRoot, "Projects/Parent");
      await expectFolderMissing(vaultRoot, "Projects/Parent/Child");
    });
  });

  it("commits folder creation and missing safe parents without creating Markdown files", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "create_folder", path: "Projects/Parent/Child", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({
        status: "success",
        operation: "create_folder",
        path: "Projects/Parent/Child",
        dryRun: false,
        committed: true,
        target: { targetKind: "folder", existsBefore: false, existsAfter: true, folderExistsAfter: true, createdParentDirectories: true },
      });
      expect(await folderExists(vaultRoot, "Projects/Parent")).toBe(true);
      expect(await folderExists(vaultRoot, "Projects/Parent/Child")).toBe(true);
      expect(await pathExists(vaultRoot, "Projects/Parent/Child.md")).toBe(false);
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("returns deterministic conflicts for existing folder, file target, and parent file", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFolder(vaultRoot, "Projects/Existing");
      const existing = await obsidianWrite({ operation: "create_folder", path: "Projects/Existing", dryRun: false }, { vaultRoot });
      expect(existing).toMatchObject({ status: "conflict", committed: false, error: { code: "TARGET_FOLDER_EXISTS", category: "conflict" } });

      await seedFile(vaultRoot, "Projects/FileTarget", "do not replace");
      const fileTarget = await obsidianWrite({ operation: "create_folder", path: "Projects/FileTarget", dryRun: false }, { vaultRoot });
      expect(fileTarget).toMatchObject({ status: "conflict", committed: false, error: { code: "TARGET_NOT_FOLDER", category: "conflict" } });

      await seedFile(vaultRoot, "Blocked", "parent blocker");
      const parentFile = await obsidianWrite({ operation: "create_folder", path: "Blocked/Child", dryRun: false }, { vaultRoot });
      expect(parentFile).toMatchObject({ status: "conflict", committed: false, error: { code: "PARENT_NOT_FOLDER", category: "conflict" } });

      for (const result of [existing, fileTarget, parentFile]) expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("rejects supplied content with CONTENT_NOT_ALLOWED and no mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "create_folder", path: "Projects/With Content", content: "# Not a note", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "validation_error", committed: false, error: { code: "CONTENT_NOT_ALLOWED", category: "validation" } });
      await expectFolderMissing(vaultRoot, "Projects/With Content");
      expect(await pathExists(vaultRoot, "Projects/With Content.md")).toBe(false);
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });
});
