import { describe, expect, it } from "vitest";
import { createCommitTokenPolicy, DefaultCommitTokenService } from "../src/commit-token.js";
import { obsidianWrite } from "../src/write-engine.js";
import { folderExists, pathExists, readNote, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_write commit tokens", () => {
  it("keeps create, create_folder, and append token-free by default", async () => {
    await withTempVault(async (vaultRoot) => {
      const tokenPolicy = createCommitTokenPolicy();
      expect(await obsidianWrite({ operation: "create_folder", path: "Notes", dryRun: false }, { vaultRoot, tokenPolicy })).toMatchObject({ status: "success", committed: true });
      expect(await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# New\n", dryRun: false }, { vaultRoot, tokenPolicy })).toMatchObject({ status: "success", committed: true });
      expect(await obsidianWrite({ operation: "append", path: "Notes/New.md", content: "More\n", dryRun: false }, { vaultRoot, tokenPolicy })).toMatchObject({ status: "success", committed: true });
      expect(await readNote(vaultRoot, "Notes/New.md")).toBe("# New\nMore\n");
    });
  });

  it("requires matching tokens for all write commits in strict mode", async () => {
    await withTempVault(async (vaultRoot) => {
      const tokenPolicy = createCommitTokenPolicy({ strictMode: true });
      const tokenService = new DefaultCommitTokenService({ secret: "write-secret" });
      const folderPreview = await obsidianWrite({ operation: "create_folder", path: "Notes" }, { vaultRoot, tokenPolicy, tokenService });
      expect(folderPreview).toMatchObject({ status: "preview", tokenRequired: true, tokenPolicy: { mode: "strict_all_mutations" } });
      expect(folderPreview.confirmationToken).toEqual(expect.any(String));
      expect(await obsidianWrite({ operation: "create_folder", path: "Notes", dryRun: false }, { vaultRoot, tokenPolicy, tokenService })).toMatchObject({ status: "safety_refusal", error: { code: "CONFIRMATION_TOKEN_REQUIRED" } });
      expect(await folderExists(vaultRoot, "Notes")).toBe(false);
      expect(await obsidianWrite({ operation: "create_folder", path: "Notes", dryRun: false, confirmationToken: folderPreview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService })).toMatchObject({ status: "success", committed: true });

      const createPreview = await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# New\n" }, { vaultRoot, tokenPolicy, tokenService });
      expect(createPreview.confirmationToken).toEqual(expect.any(String));
      const changedContent = await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# Changed\n", dryRun: false, confirmationToken: createPreview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService });
      expect(changedContent).toMatchObject({ status: "safety_refusal", error: { code: "CONFIRMATION_TOKEN_MISMATCH" } });
      expect(await pathExists(vaultRoot, "Notes/New.md")).toBe(false);
      expect(await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# New\n", dryRun: false, confirmationToken: createPreview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService })).toMatchObject({ status: "success", committed: true });

      const appendPreview = await obsidianWrite({ operation: "append", path: "Notes/New.md", content: "More\n" }, { vaultRoot, tokenPolicy, tokenService });
      expect(appendPreview.confirmationToken).toEqual(expect.any(String));
      expect(await obsidianWrite({ operation: "append", path: "Notes/New.md", content: "More\n", dryRun: false, confirmationToken: appendPreview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService })).toMatchObject({ status: "success", committed: true });
      expect(await readNote(vaultRoot, "Notes/New.md")).toBe("# New\nMore\n");
    });
  });

  it("refuses expired and unsupported-version strict write tokens before mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      let now = 1_000_000;
      const tokenPolicy = createCommitTokenPolicy({ strictMode: true, ttlSeconds: 30 });
      const tokenService = new DefaultCommitTokenService({ secret: "write-secret", now: () => now });
      const preview = await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# New\n" }, { vaultRoot, tokenPolicy, tokenService });
      const unsupported = await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# New\n", dryRun: false, confirmationToken: preview.confirmationToken!.replace(/^ct1\./, "ct9.") }, { vaultRoot, tokenPolicy, tokenService });
      expect(unsupported).toMatchObject({ status: "safety_refusal", error: { code: "CONFIRMATION_TOKEN_POLICY_MISMATCH" } });
      now = 1_031_000;
      const expired = await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# New\n", dryRun: false, confirmationToken: preview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService });
      expect(expired).toMatchObject({ status: "safety_refusal", error: { code: "CONFIRMATION_TOKEN_EXPIRED" } });
      expect(await pathExists(vaultRoot, "Notes/New.md")).toBe(false);
    });
  });

  it("fails closed in strict mode when token service is unavailable", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFolder(vaultRoot, "Notes");
      await seedNote(vaultRoot, "Notes/Existing.md", "# Existing\n");
      const tokenPolicy = createCommitTokenPolicy({ strictMode: true });
      const tokenService = new DefaultCommitTokenService({ available: false });
      const preview = await obsidianWrite({ operation: "append", path: "Notes/Existing.md", content: "More\n" }, { vaultRoot, tokenPolicy, tokenService });
      expect(preview).toMatchObject({ status: "preview", tokenRequired: true });
      expect(preview.confirmationToken).toBeUndefined();
      const commit = await obsidianWrite({ operation: "append", path: "Notes/Existing.md", content: "More\n", dryRun: false, confirmationToken: "ct1.payload.signature" }, { vaultRoot, tokenPolicy, tokenService });
      expect(commit).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_UNAVAILABLE" } });
      expect(await readNote(vaultRoot, "Notes/Existing.md")).toBe("# Existing\n");
    });
  });
});
