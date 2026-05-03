import { symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { obsidianDestroy } from "../src/destroy-engine.js";
import type { ObsidianDestroyOutput } from "../src/destroy-types.js";
import { executeTool, fakePi, folderExists, pathExists, readNote, registerVaultExtensionForTest, seedFile, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";
import { registerObsidianVault } from "../src/index.js";

describe("obsidian_destroy", () => {
  it("permanently deletes one explicit Markdown note", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Old.md", "# Old\n");
      const preview = await obsidianDestroy({ operation: "delete_note", path: "Projects/Old.md" }, { vaultRoot });
      expect(preview).toMatchObject({ status: "preview", committed: false, preview: { operation: "delete_note", permanentlyDeletes: true }, target: { existsAfter: true } });
      expect(await pathExists(vaultRoot, "Projects/Old.md")).toBe(true);

      const commit = await obsidianDestroy({ operation: "delete_note", path: "Projects/Old.md", dryRun: false }, { vaultRoot });
      expect(commit).toMatchObject({ status: "success", committed: true, target: { existsAfter: false } });
      expect(await pathExists(vaultRoot, "Projects/Old.md")).toBe(false);
    });
  });

  it("replaces an existing Markdown note without creating missing notes", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Roadmap.md", "# Old\n");
      const preview = await obsidianDestroy({ operation: "replace_note", path: "Projects/Roadmap.md", content: "# New\n" }, { vaultRoot });
      expect(preview).toMatchObject({ status: "preview", committed: false, preview: { wouldReplace: true, beforePreview: "# Old\n", afterPreview: "# New\n" } });
      expect(await readNote(vaultRoot, "Projects/Roadmap.md")).toBe("# Old\n");

      const commit = await obsidianDestroy({ operation: "replace_note", path: "Projects/Roadmap.md", content: "# New\n", dryRun: false }, { vaultRoot });
      expect(commit).toMatchObject({ status: "success", committed: true, target: { bytesAfter: 6 } });
      expect(await readNote(vaultRoot, "Projects/Roadmap.md")).toBe("# New\n");

      const missing = await obsidianDestroy({ operation: "replace_note", path: "Projects/Missing.md", content: "# Missing\n", dryRun: false }, { vaultRoot });
      expect(missing).toMatchObject({ status: "not_found", committed: false, error: { code: "TARGET_MISSING" } });

      const truncated = await obsidianDestroy({ operation: "replace_note", path: "Projects/Roadmap.md", content: "# A much longer replacement\n" }, { vaultRoot, maxPreviewChars: 5 });
      expect(truncated.preview).toMatchObject({ beforePreview: "# Ne…", afterPreview: "# A …", previewTruncated: true });
    });
  });

  it("recursively deletes one explicit folder and empties the default trash folder", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Archive/Old/A.md", "# A\n");
      await seedNote(vaultRoot, "Archive/Old/Nested/B.md", "# B\n");
      const folderPreview = await obsidianDestroy({ operation: "delete_folder", path: "Archive/Old" }, { vaultRoot });
      expect(folderPreview).toMatchObject({ status: "preview", target: { entryCount: 3, fileCount: 2, folderCount: 1 }, preview: { wouldDelete: true } });
      expect(await folderExists(vaultRoot, "Archive/Old")).toBe(true);

      const folderCommit = await obsidianDestroy({ operation: "delete_folder", path: "Archive/Old", dryRun: false }, { vaultRoot });
      expect(folderCommit).toMatchObject({ status: "success", committed: true, target: { existsAfter: false } });
      expect(await folderExists(vaultRoot, "Archive/Old")).toBe(false);

      await seedNote(vaultRoot, "_Trash/A.md", "# A\n");
      await seedNote(vaultRoot, "_Trash/Nested/B.md", "# B\n");
      const emptyPreview = await obsidianDestroy({ operation: "empty_trash" }, { vaultRoot });
      expect(emptyPreview).toMatchObject({ status: "preview", trashFolder: "_Trash", target: { entryCount: 3, fileCount: 2, folderCount: 1 }, preview: { wouldEmptyTrash: true } });

      const emptyCommit = await obsidianDestroy({ operation: "empty_trash", dryRun: false }, { vaultRoot });
      expect(emptyCommit).toMatchObject({ status: "success", committed: true, target: { existsAfter: true } });
      expect(await folderExists(vaultRoot, "_Trash")).toBe(true);
      expect(await pathExists(vaultRoot, "_Trash/A.md")).toBe(false);
      expect(await pathExists(vaultRoot, "_Trash/Nested/B.md")).toBe(false);
    });
  });

  it("refuses unsafe destructive targets including root, .obsidian, wildcards, and symlinks", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/A.md", "# A\n");
      await seedFolder(vaultRoot, "Links");
      await seedFile(vaultRoot, "Outside.md", "# Outside\n");
      await symlink(path.join(vaultRoot, "Outside.md"), path.join(vaultRoot, "Links", "Outside.md"));

      for (const request of [
        { operation: "delete_folder", path: "." },
        { operation: "delete_note", path: ".obsidian/config.md" },
        { operation: "delete_note", path: "Notes/*.md" },
        { operation: "delete_note", path: "Links/Outside.md" },
      ]) {
        const result = await obsidianDestroy(request, { vaultRoot });
        expect(result.committed).toBe(false);
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
      }
      expect(await pathExists(vaultRoot, "Notes/A.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Outside.md")).toBe(true);
    });
  });

  it("uses destructive approval separately from auto-write", async () => {
    await withTempVault(async (vaultRoot) => {
      const { pi } = registerVaultExtensionForTest(vaultRoot);
      await seedNote(vaultRoot, "Notes/One.md", "# One\n");
      await seedNote(vaultRoot, "Notes/Two.md", "# Two\n");
      await seedNote(vaultRoot, "Notes/Three.md", "# Three\n");
      await seedNote(vaultRoot, "Notes/Four.md", "# Four\n");

      await pi.commands.get("obsidian-vault").handler("auto-write on", { ui: { notify() {} } });
      const autoWriteDoesNotDestroy = await executeTool<ObsidianDestroyOutput>(pi, "obsidian_destroy", { operation: "delete_note", path: "Notes/One.md" });
      expect(autoWriteDoesNotDestroy).toMatchObject({ status: "preview", committed: false });
      expect(await pathExists(vaultRoot, "Notes/One.md")).toBe(true);

      const explicitFalseWithoutUi = await executeTool<ObsidianDestroyOutput>(pi, "obsidian_destroy", { operation: "delete_note", path: "Notes/One.md", dryRun: false });
      expect(explicitFalseWithoutUi).toMatchObject({ status: "preview", committed: false, dryRun: true });
      expect(await pathExists(vaultRoot, "Notes/One.md")).toBe(true);

      const denied = await pi.tools.get("obsidian_destroy").execute("id", { operation: "delete_note", path: "Notes/One.md" }, undefined, undefined, { ui: { select() { return "No"; } } });
      expect(denied.details).toMatchObject({ status: "preview", committed: false, message: "Cancelled by user; no destructive Obsidian vault changes were made." });
      expect(await pathExists(vaultRoot, "Notes/One.md")).toBe(true);

      let selectCalls = 0;
      const enabled = await pi.tools.get("obsidian_destroy").execute("id", { operation: "delete_note", path: "Notes/Two.md" }, undefined, undefined, {
        ui: {
          select(_title: string, choices: string[]) {
            selectCalls += 1;
            expect(choices).toEqual(["Yes, destroy", "No", "Auto-destroy this session"]);
            return "Auto-destroy this session";
          },
        },
      });
      expect(enabled.details).toMatchObject({ status: "success", committed: true });
      expect(await pathExists(vaultRoot, "Notes/Two.md")).toBe(false);

      const skipped = await executeTool<ObsidianDestroyOutput>(pi, "obsidian_destroy", { operation: "delete_note", path: "Notes/Three.md" });
      expect(skipped).toMatchObject({ status: "success", committed: true });
      expect(skipped.warnings.join("\n")).toMatch(/Auto-destroy is enabled/i);
      expect(selectCalls).toBe(1);
      expect(await pathExists(vaultRoot, "Notes/Three.md")).toBe(false);

      const dryRunStillPreviews = await executeTool<ObsidianDestroyOutput>(pi, "obsidian_destroy", { operation: "delete_note", path: "Notes/Four.md", dryRun: true });
      expect(dryRunStillPreviews).toMatchObject({ status: "preview", committed: false, dryRun: true });
      expect(await pathExists(vaultRoot, "Notes/Four.md")).toBe(true);
    });
  });
});
