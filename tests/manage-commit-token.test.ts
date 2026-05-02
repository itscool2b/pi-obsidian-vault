import { describe, expect, it } from "vitest";
import { createCommitTokenPolicy, DefaultCommitTokenService } from "../src/commit-token.js";
import { obsidianManage } from "../src/manage-engine.js";
import { pathExists, readNote, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage commit tokens", () => {
  it("issues tokens for all management dry-runs by default", async () => {
    await withTempVault(async (vaultRoot) => {
      const tokenPolicy = createCommitTokenPolicy();
      const tokenService = new DefaultCommitTokenService({ secret: "manage-secret" });
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      await seedNote(vaultRoot, "_Trash/Restore.md", "# Restore\n");
      await seedFolder(vaultRoot, "Archive");
      await seedFolder(vaultRoot, "Projects");

      const previews = [
        await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }, { vaultRoot, tokenPolicy, tokenService }),
        await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md" }, { vaultRoot, tokenPolicy, tokenService }),
        await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Restore.md", toPath: "Projects/Restore.md" }, { vaultRoot, tokenPolicy, tokenService }),
        await obsidianManage({ operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Copy.md" }, { vaultRoot, tokenPolicy, tokenService }),
      ];
      for (const preview of previews) {
        expect(preview).toMatchObject({ status: "preview", tokenRequired: true, tokenPolicy: { mode: "default_risky" } });
        expect(preview.confirmationToken).toEqual(expect.any(String));
      }
    });
  });

  it("refuses invalid or mismatched manage tokens before mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      let now = 1_000_000;
      const tokenPolicy = createCommitTokenPolicy({ ttlSeconds: 30 });
      const tokenService = new DefaultCommitTokenService({ secret: "manage-secret", now: () => now });
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      await seedFolder(vaultRoot, "Archive");
      const preview = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }, { vaultRoot, tokenPolicy, tokenService });
      const token = preview.confirmationToken!;

      const missing = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot, tokenPolicy, tokenService });
      expect(missing).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_REQUIRED" } });
      const malformed = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false, confirmationToken: "bad.token" }, { vaultRoot, tokenPolicy, tokenService });
      expect(malformed).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_MALFORMED" } });
      const mismatch = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Changed.md", dryRun: false, confirmationToken: token }, { vaultRoot, tokenPolicy, tokenService });
      expect(mismatch).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_MISMATCH" } });
      now = 1_031_000;
      const expired = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false, confirmationToken: token }, { vaultRoot, tokenPolicy, tokenService });
      expect(expired).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_EXPIRED" } });
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Archive/Plan.md")).toBe(false);
    });
  });

  it("commits move, trash, restore, and copy with valid matching tokens", async () => {
    await withTempVault(async (vaultRoot) => {
      const tokenPolicy = createCommitTokenPolicy();
      const tokenService = new DefaultCommitTokenService({ secret: "manage-secret" });
      await seedNote(vaultRoot, "Projects/Move.md", "# Move\n");
      await seedNote(vaultRoot, "Projects/Trash.md", "# Trash\n");
      await seedNote(vaultRoot, "_Trash/Restore.md", "# Restore\n");
      await seedNote(vaultRoot, "Projects/Copy.md", "# Copy\n");
      await seedFolder(vaultRoot, "Archive");

      const movePreview = await obsidianManage({ operation: "move_note", fromPath: "Projects/Move.md", toPath: "Archive/Move.md" }, { vaultRoot, tokenPolicy, tokenService });
      expect(await obsidianManage({ operation: "move_note", fromPath: "Projects/Move.md", toPath: "Archive/Move.md", dryRun: false, confirmationToken: movePreview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService })).toMatchObject({ status: "success", committed: true });

      const trashPreview = await obsidianManage({ operation: "trash_note", path: "Projects/Trash.md" }, { vaultRoot, tokenPolicy, tokenService });
      expect(await obsidianManage({ operation: "trash_note", path: "Projects/Trash.md", dryRun: false, confirmationToken: trashPreview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService })).toMatchObject({ status: "success", committed: true, trashPath: "_Trash/Trash.md" });

      const restorePreview = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Restore.md", toPath: "Projects/Restore.md" }, { vaultRoot, tokenPolicy, tokenService });
      expect(await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Restore.md", toPath: "Projects/Restore.md", dryRun: false, confirmationToken: restorePreview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService })).toMatchObject({ status: "success", committed: true });

      const copyPreview = await obsidianManage({ operation: "copy_note", fromPath: "Projects/Copy.md", toPath: "Archive/Copy.md" }, { vaultRoot, tokenPolicy, tokenService });
      expect(await obsidianManage({ operation: "copy_note", fromPath: "Projects/Copy.md", toPath: "Archive/Copy.md", dryRun: false, confirmationToken: copyPreview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService })).toMatchObject({ status: "success", committed: true });
      expect(await readNote(vaultRoot, "Archive/Copy.md")).toBe("# Copy\n");
    });
  });

  it("fails closed when token service is unavailable", async () => {
    await withTempVault(async (vaultRoot) => {
      const tokenPolicy = createCommitTokenPolicy();
      const tokenService = new DefaultCommitTokenService({ available: false });
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      await seedFolder(vaultRoot, "Archive");
      const preview = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }, { vaultRoot, tokenPolicy, tokenService });
      expect(preview).toMatchObject({ status: "preview", tokenRequired: true });
      expect(preview.confirmationToken).toBeUndefined();
      const commit = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false, confirmationToken: "ct1.payload.signature" }, { vaultRoot, tokenPolicy, tokenService });
      expect(commit).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_UNAVAILABLE" } });
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Archive/Plan.md")).toBe(false);
    });
  });
});
