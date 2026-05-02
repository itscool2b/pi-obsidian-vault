import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { pathExists, readNote, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

const LINKED_NOTE = "# Plan\nSee [[Projects/Roadmap]] and [Design](Design.md).\n";

describe("obsidian_manage dry-run link impact previews", () => {
  it("adds link impact metadata to move_note dry-run without mutation or link rewriting", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", LINKED_NOTE);
      await seedFolder(vaultRoot, "Archive");

      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({ status: "preview", committed: false, linkImpact: { sourcePath: "Projects/Plan.md", outgoingWikiLinkCount: 1, outgoingMarkdownLinkCount: 1, hasOutgoingLinks: true, linkRewriteSupported: false } });
      expect(result.linkImpact?.linkImpactWarning).toMatch(/inbound links may be affected/i);
      expect(result.degradedSignals).toEqual(["backlinks", "relationships"]);
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe(LINKED_NOTE);
      expect(await pathExists(vaultRoot, "Archive/Plan.md")).toBe(false);
    });
  });

  it("adds link impact metadata to trash_note dry-run without creating trash", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", LINKED_NOTE);

      const result = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({ status: "preview", committed: false, linkImpact: { sourcePath: "Projects/Plan.md", outgoingWikiLinkCount: 1, outgoingMarkdownLinkCount: 1, hasOutgoingLinks: true, linkRewriteSupported: false } });
      expect(result.linkImpact?.linkImpactWarning).toMatch(/inbound links may be affected/i);
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe(LINKED_NOTE);
      expect(await pathExists(vaultRoot, "_Trash")).toBe(false);
    });
  });

  it("adds link impact metadata to restore_note dry-run from readable trash source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", LINKED_NOTE);
      await seedFolder(vaultRoot, "Projects");

      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({ status: "preview", committed: false, linkImpact: { sourcePath: "_Trash/Plan.md", outgoingWikiLinkCount: 1, outgoingMarkdownLinkCount: 1, hasOutgoingLinks: true, linkRewriteSupported: false } });
      expect(result.linkImpact?.linkImpactWarning).toMatch(/does not rewrite links/i);
      expect(await readNote(vaultRoot, "_Trash/Plan.md")).toBe(LINKED_NOTE);
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(false);
    });
  });

  it("adds link impact metadata to copy_note dry-run without creating the destination", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", LINKED_NOTE);
      await seedFolder(vaultRoot, "Archive");

      const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }, { vaultRoot });

      expect(result).toMatchObject({ status: "preview", committed: false, linkImpact: { sourcePath: "Projects/Plan.md", outgoingWikiLinkCount: 1, outgoingMarkdownLinkCount: 1, hasOutgoingLinks: true, linkRewriteSupported: false } });
      expect(result.linkImpact?.linkImpactWarning).toMatch(/copied content will preserve link targets exactly/i);
      expect(result.degradedSignals).toBeUndefined();
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe(LINKED_NOTE);
      expect(await pathExists(vaultRoot, "Archive/Plan.md")).toBe(false);
    });
  });

  it("does not add link impact metadata to committed manage results", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", LINKED_NOTE);
      await seedFolder(vaultRoot, "Archive");

      const result = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({ status: "success", committed: true });
      expect(result.linkImpact).toBeUndefined();
    });
  });
});
