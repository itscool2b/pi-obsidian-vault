import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { UNSAFE_FOLDER_PATHS, UNSAFE_RESTORE_PATHS } from "./release-hardening-fixtures.js";
import { expectNoLocalPathLeak, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage restore_note path safety", () => {
  it("refuses unsafe trashPath values without echoing raw paths", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFolder(vaultRoot, "Projects");
      for (const trashPath of UNSAFE_RESTORE_PATHS) {
        if (!trashPath.trim()) continue;
        const result = await obsidianManage({ operation: "restore_note", trashPath, toPath: "Projects/Plan.md" }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
        expect(result.committed).toBe(false);
        expect(["UNSAFE_TRASH_PATH", "TRASH_SOURCE_NOT_MARKDOWN"]).toContain(result.error?.code);
        expect(JSON.stringify(result)).not.toContain(trashPath.startsWith("/") ? trashPath : `${vaultRoot}/${trashPath}`);
        expectNoLocalPathLeak(result, vaultRoot);
      }
    });
  });

  it("refuses unsafe destination paths without mutating the trash note", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "source");
      for (const toPath of UNSAFE_RESTORE_PATHS) {
        if (!toPath.trim()) continue;
        const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
        expect(result.committed).toBe(false);
        expect(["UNSAFE_TO_PATH", "TARGET_NOT_MARKDOWN", "SAME_PATH"]).toContain(result.error?.code);
        expectNoLocalPathLeak(result, vaultRoot);
      }
    });
  });

  it("refuses unsafe trashFolder values", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "source");
      await seedFolder(vaultRoot, "Projects");
      for (const trashFolder of UNSAFE_FOLDER_PATHS) {
        if (!trashFolder.trim()) continue;
        const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", trashFolder }, { vaultRoot });
        expect(result.status).toBe("safety_refusal");
        expect(result.committed).toBe(false);
        expect(result.error?.code).toBe("UNSAFE_TRASH_FOLDER");
        expectNoLocalPathLeak(result, vaultRoot);
      }
    });
  });

  it("requires trashPath inside the selected trashFolder", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Trash/Plan.md", "source");
      await seedFolder(vaultRoot, "Projects");
      const result = await obsidianManage({ operation: "restore_note", trashPath: "Trash/Plan.md", toPath: "Projects/Plan.md", trashFolder: "Archive/Trash" }, { vaultRoot });
      expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "TRASH_PATH_OUTSIDE_TRASH", category: "safety" } });
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("uses validation errors for missing restore parameters", async () => {
    await withTempVault(async (vaultRoot) => {
      expect(await obsidianManage({ operation: "restore_note", toPath: "Projects/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_TRASH_PATH" } });
      expect(await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_TO_PATH" } });
    });
  });
});
