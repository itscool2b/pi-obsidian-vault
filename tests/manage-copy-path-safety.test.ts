import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { UNSAFE_COPY_PATHS } from "./release-hardening-fixtures.js";
import { expectNoLocalPathLeak, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage copy_note path safety", () => {
  it("refuses unsafe fromPath values without echoing raw paths", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFolder(vaultRoot, "Archive");
      for (const fromPath of UNSAFE_COPY_PATHS) {
        if (!fromPath.trim()) continue;
        const result = await obsidianManage({ operation: "copy_note", fromPath, toPath: "Archive/Plan.md" }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
        expect(result.committed).toBe(false);
        expect(["UNSAFE_FROM_PATH", "SOURCE_NOT_MARKDOWN"]).toContain(result.error?.code);
        expect(JSON.stringify(result)).not.toContain(fromPath.startsWith("/") ? fromPath : `${vaultRoot}/${fromPath}`);
        expectNoLocalPathLeak(result, vaultRoot);
      }
    });
  });

  it("refuses unsafe toPath values without mutating the source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      for (const toPath of UNSAFE_COPY_PATHS) {
        if (!toPath.trim()) continue;
        const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
        expect(result.committed).toBe(false);
        expect(["UNSAFE_TO_PATH", "TARGET_NOT_MARKDOWN", "SAME_PATH"]).toContain(result.error?.code);
        expectNoLocalPathLeak(result, vaultRoot);
      }
    });
  });

  it("uses validation errors for missing copy parameters", async () => {
    await withTempVault(async (vaultRoot) => {
      expect(await obsidianManage({ operation: "copy_note", toPath: "Projects/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_FROM_PATH" } });
      expect(await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_TO_PATH" } });
    });
  });
});
