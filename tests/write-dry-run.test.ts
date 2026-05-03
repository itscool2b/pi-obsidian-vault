import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { obsidianWrite } from "../src/write-engine.js";
import { absoluteNotePath, readNote, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_write dry-run previews", () => {
  it("previews create without creating files or parent directories", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "create", path: "Preview/New.md", content: "# Preview", dryRun: true }, { vaultRoot });
      expect(result).toMatchObject({ status: "preview", dryRun: true, committed: false, preview: { wouldCreate: true, path: "Preview/New.md" } });
      await expect(access(absoluteNotePath(vaultRoot, "Preview/New.md"))).rejects.toThrow();
      await expect(access(absoluteNotePath(vaultRoot, "Preview"))).rejects.toThrow();
    });
  });

  it("previews append without changing existing content", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Preview/Existing.md", "base");
      const result = await obsidianWrite({ operation: "append", path: "Preview/Existing.md", content: " appended", dryRun: true }, { vaultRoot });
      expect(result).toMatchObject({ status: "preview", dryRun: true, committed: false, preview: { wouldAppend: true, path: "Preview/Existing.md" } });
      expect(await readNote(vaultRoot, "Preview/Existing.md")).toBe("base");
    });
  });

  it("defaults to preview and preserves normal-sized content previews", async () => {
    await withTempVault(async (vaultRoot) => {
      const long = "x".repeat(800);
      const result = await obsidianWrite({ operation: "create", path: "Preview/Default.md", content: long }, { vaultRoot });
      expect(result.status).toBe("preview");
      expect(result.dryRun).toBe(true);
      expect(result.preview?.contentChars).toBe(800);
      expect(result.preview?.previewTruncated).toBe(false);
      expect(result.preview?.contentPreview?.length ?? 0).toBe(800);
      expect(result.nextActions.map((action) => action.action)).toContain("confirm_preview");
      await expect(access(absoluteNotePath(vaultRoot, "Preview/Default.md"))).rejects.toThrow();
    });
  });
});
