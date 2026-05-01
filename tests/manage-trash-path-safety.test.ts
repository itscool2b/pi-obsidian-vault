import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { pathExists, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

const unsafeSourcePaths = [
  "/tmp/outside.md",
  "C:\\Users\\me\\outside.md",
  "\\\\server\\share\\outside.md",
  "../outside.md",
  "Folder/%2e%2e/outside.md",
  "Folder/%25252e%25252e/outside.md",
  ".obsidian/config.md",
  ".hidden/Plan.md",
  "Projects/*.md",
  "Projects/**/Plan.md",
  "Projects/One.md,Projects/Two.md",
  "",
  "   ",
  ".",
  "@",
];

const unsafeTrashFolders = [
  "/tmp/trash",
  "C:\\Users\\me\\Trash",
  "\\\\server\\share\\Trash",
  "../Trash",
  "Folder/%2e%2e/Trash",
  "Folder/%25252e%25252e/Trash",
  ".obsidian/trash",
  ".hidden/Trash",
  "Trash.md",
  "Trash.txt",
  "Trash/*",
  "Trash,Archive",
  "",
  "   ",
  ".",
  "@",
];

describe("obsidian_manage trash_note path safety", () => {
  it("rejects unsafe source paths without leaking raw absolute paths", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const sourcePath of unsafeSourcePaths) {
        const result = await obsidianManage({ operation: "trash_note", path: sourcePath, dryRun: false }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
        expect(result.committed).toBe(false);
        const text = stringifyDetails(result);
        expect(text).not.toContain(vaultRoot);
        expect(text).not.toContain("/tmp/outside.md");
        expect(text).not.toContain("C:\\Users\\me\\outside.md");
      }
    });
  });

  it("rejects unsafe trashFolder paths without leaking raw absolute paths or moving source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      for (const trashFolder of unsafeTrashFolders) {
        const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md", trashFolder, dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "UNSAFE_TRASH_FOLDER", category: "safety" } });
        const text = stringifyDetails(result);
        expect(text).not.toContain(vaultRoot);
        expect(text).not.toContain("/tmp/trash");
        expect(text).not.toContain("C:\\Users\\me\\Trash");
        expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(true);
      }
    });
  });

  it("returns validation_error for non-Markdown source paths", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.txt" }, { vaultRoot });
      expect(result).toMatchObject({ status: "validation_error", committed: false, error: { code: "SOURCE_NOT_MARKDOWN", category: "validation" } });
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("returns conflict when source normalizes to the computed final trash path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "already in trash");
      const result = await obsidianManage({ operation: "trash_note", path: "@_Trash/Plan.md", trashFolder: "_Trash", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "TRASH_TARGET_EXISTS", category: "conflict" }, path: "_Trash/Plan.md", trashPath: "_Trash/Plan.md" });
      expect(await pathExists(vaultRoot, "_Trash/Plan.md")).toBe(true);
    });
  });
});
