import { describe, expect, it } from "vitest";
import type { ObsidianEditOutput, ObsidianManageOutput, ObsidianRetrieveOutput, ObsidianWriteOutput } from "../src/index.js";
import { executeTool, expectNoLocalPathLeak, folderExists, pathExists, readNote, registerVaultExtensionForTest, runStatusCommand, vaultSnapshot, withTempVault } from "./write-test-utils.js";
import { unexpectedFakeCliSideEffectCalls } from "./fake-obsidian-cli.js";
import { requireCapabilities } from "./status-test-utils.js";

describe("release hardening temporary-vault smoke", () => {
  it("drives the full public tool lifecycle without touching a real vault", async () => {
    await withTempVault(async (vaultRoot) => {
      const { pi, backend } = registerVaultExtensionForTest(vaultRoot);
      const notePath = "Smoke/Workspace/Plan.md";
      const movedPath = "Smoke/Archive/Plan.md";
      const copyPath = "Smoke/Archive/Plan Copy.md";
      const trashPath = "_Trash/Plan.md";
      const initialContent = "# Plan\n\n## Log\nInitial line.\n\n## Section\nOld section text.\n\n## Tail\nEnd.\n";

      const previewFolder = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create_folder", path: "Smoke/Workspace" });
      expect(previewFolder).toMatchObject({ status: "preview", dryRun: true, committed: false, operation: "create_folder" });
      expect(await folderExists(vaultRoot, "Smoke/Workspace")).toBe(false);
      expectNoLocalPathLeak(previewFolder, vaultRoot);

      const commitFolder = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create_folder", path: "Smoke/Workspace", dryRun: false });
      expect(commitFolder).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await folderExists(vaultRoot, "Smoke/Workspace")).toBe(true);

      const previewCreate = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create", path: notePath, content: initialContent });
      expect(previewCreate).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await pathExists(vaultRoot, notePath)).toBe(false);

      const commitCreate = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create", path: notePath, content: initialContent, dryRun: false });
      expect(commitCreate).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toBe(initialContent);

      const previewAppend = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "append", path: notePath, content: "\nAppend marker: alpha.\n" });
      expect(previewAppend).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await readNote(vaultRoot, notePath)).toBe(initialContent);

      const commitAppend = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "append", path: notePath, content: "\nAppend marker: alpha.\n", dryRun: false });
      expect(commitAppend).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toContain("Append marker: alpha.");

      const beforeRetrieve = await vaultSnapshot(vaultRoot);
      const retrieval = await executeTool<ObsidianRetrieveOutput>(pi, "obsidian_retrieve", { query: "create move trash restore copy delete Smoke Plan", mode: "search", budget: "tiny" });
      expect(retrieval.warnings.join("\n")).toMatch(/read-only/i);
      expect(unexpectedFakeCliSideEffectCalls(backend)).toEqual([]);
      expect(await vaultSnapshot(vaultRoot)).toEqual(beforeRetrieve);

      const previewSection = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "replace_section", path: notePath, heading: "## Section", content: "Updated section text." });
      expect(previewSection).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await readNote(vaultRoot, notePath)).toContain("Old section text.");

      const commitSection = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "replace_section", path: notePath, heading: "## Section", content: "Updated section text.", dryRun: false, confirmationToken: previewSection.confirmationToken });
      expect(commitSection).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toContain("Updated section text.");

      const previewExact = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "replace_exact_text", path: notePath, oldText: "Append marker: alpha.", newText: "Append marker: beta." });
      expect(previewExact).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await readNote(vaultRoot, notePath)).toContain("Append marker: alpha.");

      const commitExact = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "replace_exact_text", path: notePath, oldText: "Append marker: alpha.", newText: "Append marker: beta.", dryRun: false, confirmationToken: previewExact.confirmationToken });
      expect(commitExact).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toContain("Append marker: beta.");

      const previewFrontmatter = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "update_frontmatter", path: notePath, property: "status", value: "hardened" });
      expect(previewFrontmatter).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await readNote(vaultRoot, notePath)).not.toContain("status: hardened");

      const commitFrontmatter = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "update_frontmatter", path: notePath, property: "status", value: "hardened", dryRun: false });
      expect(commitFrontmatter).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toContain("status: hardened");

      await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create_folder", path: "Smoke/Archive", dryRun: false });
      const beforeMoveContent = await readNote(vaultRoot, notePath);
      const previewMove = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "move_note", fromPath: notePath, toPath: movedPath });
      expect(previewMove).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await pathExists(vaultRoot, movedPath)).toBe(false);

      const commitMove = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "move_note", fromPath: notePath, toPath: movedPath, dryRun: false, confirmationToken: previewMove.confirmationToken });
      expect(commitMove).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await pathExists(vaultRoot, notePath)).toBe(false);
      expect(await readNote(vaultRoot, movedPath)).toBe(beforeMoveContent);

      const previewTrash = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "trash_note", path: movedPath });
      expect(previewTrash).toMatchObject({ status: "preview", dryRun: true, committed: false, trashFolder: "_Trash", trashPath });
      expect(await pathExists(vaultRoot, movedPath)).toBe(true);
      expect(await pathExists(vaultRoot, trashPath)).toBe(false);

      const commitTrash = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "trash_note", path: movedPath, dryRun: false, confirmationToken: previewTrash.confirmationToken });
      expect(commitTrash).toMatchObject({ status: "success", dryRun: false, committed: true, trashPath });
      expect(await pathExists(vaultRoot, movedPath)).toBe(false);
      expect(await readNote(vaultRoot, trashPath)).toBe(beforeMoveContent);

      const previewRestore = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "restore_note", trashPath, toPath: movedPath });
      expect(previewRestore).toMatchObject({ status: "preview", dryRun: true, committed: false, trashFolder: "_Trash", trashPath, toPath: movedPath });
      expect(await pathExists(vaultRoot, trashPath)).toBe(true);
      expect(await pathExists(vaultRoot, movedPath)).toBe(false);

      const commitRestore = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "restore_note", trashPath, toPath: movedPath, dryRun: false, confirmationToken: previewRestore.confirmationToken });
      expect(commitRestore).toMatchObject({ status: "success", dryRun: false, committed: true, trashPath, toPath: movedPath });
      expect(await pathExists(vaultRoot, trashPath)).toBe(false);
      expect(await readNote(vaultRoot, movedPath)).toBe(beforeMoveContent);

      const previewCopy = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "copy_note", fromPath: movedPath, toPath: copyPath });
      expect(previewCopy).toMatchObject({ status: "preview", dryRun: true, committed: false, fromPath: movedPath, toPath: copyPath, preview: { wouldCopy: true } });
      expect(await pathExists(vaultRoot, copyPath)).toBe(false);
      expect(await readNote(vaultRoot, movedPath)).toBe(beforeMoveContent);

      const commitCopy = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "copy_note", fromPath: movedPath, toPath: copyPath, dryRun: false, confirmationToken: previewCopy.confirmationToken });
      expect(commitCopy).toMatchObject({ status: "success", dryRun: false, committed: true, fromPath: movedPath, toPath: copyPath, target: { sourceExistsAfter: true, destinationExistsAfter: true, bytesPreserved: true } });
      expect(await readNote(vaultRoot, movedPath)).toBe(beforeMoveContent);
      expect(await readNote(vaultRoot, copyPath)).toBe(beforeMoveContent);

      const beforeFinalRetrieve = await vaultSnapshot(vaultRoot);
      await executeTool<ObsidianRetrieveOutput>(pi, "obsidian_retrieve", { query: "trash restore delete move copy Smoke Plan", mode: "search", budget: "tiny" });
      expect(await vaultSnapshot(vaultRoot)).toEqual(beforeFinalRetrieve);
      expect(unexpectedFakeCliSideEffectCalls(backend)).toEqual([]);

      const status = await runStatusCommand(pi);
      const capabilities = requireCapabilities(status.message);
      expect(capabilities).toMatchObject({ retrieve: "available", write: "available", edit: "available", manage: "available" });
      expect(status.message).not.toContain(vaultRoot);
      expect(status.message).not.toMatch(/\/tmp\/pi-obsidian-write-/);

      for (const output of [previewFolder, commitFolder, previewCreate, commitCreate, previewAppend, commitAppend, retrieval, previewSection, commitSection, previewExact, commitExact, previewFrontmatter, commitFrontmatter, previewMove, commitMove, previewTrash, commitTrash, previewRestore, commitRestore, previewCopy, commitCopy]) {
        expectNoLocalPathLeak(output, vaultRoot);
      }
    });
  });
});
