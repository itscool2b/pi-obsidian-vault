import { describe, expect, it } from "vitest";
import { createCommitTokenPolicy, DefaultCommitTokenService } from "../src/commit-token.js";
import { obsidianEdit } from "../src/edit-engine.js";
import { readNote, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_edit commit tokens", () => {
  it("issues tokens for default-risky replace_section and replace_exact_text dry-runs", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Plan.md", "# Title\n\n## Plan\n\nOld section\n\nExact old.\n");
      const tokenPolicy = createCommitTokenPolicy();
      const tokenService = new DefaultCommitTokenService({ secret: "edit-secret", now: () => 1_000_000 });

      const section = await obsidianEdit({ operation: "replace_section", path: "Notes/Plan.md", heading: "## Plan", content: "New section" }, { vaultRoot, tokenPolicy, tokenService });
      expect(section).toMatchObject({ status: "preview", tokenRequired: true, tokenTtlSeconds: 300, tokenPolicy: { mode: "default_risky" } });
      expect(section.confirmationToken).toEqual(expect.any(String));

      const exact = await obsidianEdit({ operation: "replace_exact_text", path: "Notes/Plan.md", oldText: "Exact old.", newText: "Exact new." }, { vaultRoot, tokenPolicy, tokenService });
      expect(exact).toMatchObject({ status: "preview", tokenRequired: true });
      expect(exact.confirmationToken).toEqual(expect.any(String));
    });
  });

  it("refuses missing, malformed, expired, unsupported-version, policy-mismatched, and mismatched tokens before mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Plan.md", "# Title\n\n## Plan\n\nOld section\n");
      await seedNote(vaultRoot, "Notes/Other.md", "# Title\n\n## Plan\n\nOther section\n");
      let now = 1_000_000;
      const tokenPolicy = createCommitTokenPolicy({ ttlSeconds: 30 });
      const tokenService = new DefaultCommitTokenService({ secret: "edit-secret", now: () => now });
      const request = { operation: "replace_section", path: "Notes/Plan.md", heading: "## Plan", content: "New section" } as const;
      const preview = await obsidianEdit(request, { vaultRoot, tokenPolicy, tokenService });
      const token = preview.confirmationToken;
      expect(token).toEqual(expect.any(String));

      for (const [confirmationToken, code] of [
        [undefined, "CONFIRMATION_TOKEN_REQUIRED"],
        ["ct1.not.token", "CONFIRMATION_TOKEN_MALFORMED"],
        [token!.replace(/^ct1\./, "ct9."), "CONFIRMATION_TOKEN_POLICY_MISMATCH"],
      ] as const) {
        const result = await obsidianEdit({ ...request, dryRun: false, confirmationToken }, { vaultRoot, tokenPolicy, tokenService });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code } });
        expect(await readNote(vaultRoot, "Notes/Plan.md")).toContain("Old section");
      }

      const mismatch = await obsidianEdit({ ...request, content: "Changed section", dryRun: false, confirmationToken: token }, { vaultRoot, tokenPolicy, tokenService });
      expect(mismatch).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_MISMATCH" } });
      const pathMismatch = await obsidianEdit({ ...request, path: "Notes/Other.md", dryRun: false, confirmationToken: token }, { vaultRoot, tokenPolicy, tokenService });
      expect(pathMismatch).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_MISMATCH" } });
      const policyMismatch = await obsidianEdit({ ...request, dryRun: false, confirmationToken: token }, { vaultRoot, tokenPolicy: createCommitTokenPolicy({ strictMode: true }), tokenService });
      expect(policyMismatch).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_POLICY_MISMATCH" } });
      now = 1_031_000;
      const expired = await obsidianEdit({ ...request, dryRun: false, confirmationToken: token }, { vaultRoot, tokenPolicy, tokenService });
      expect(expired).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_EXPIRED" } });
      expect(await readNote(vaultRoot, "Notes/Plan.md")).toContain("Old section");
    });
  });

  it("commits with a valid matching token and keeps dry-runs non-mutating", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Plan.md", "# Title\n\n## Plan\n\nOld section\n\nExact old.\n");
      const tokenPolicy = createCommitTokenPolicy();
      const tokenService = new DefaultCommitTokenService({ secret: "edit-secret" });
      const preview = await obsidianEdit({ operation: "replace_section", path: "Notes/Plan.md", heading: "## Plan", content: "New section" }, { vaultRoot, tokenPolicy, tokenService });
      expect(await readNote(vaultRoot, "Notes/Plan.md")).toContain("Old section");

      const commit = await obsidianEdit({ operation: "replace_section", path: "Notes/Plan.md", heading: "## Plan", content: "New section", dryRun: false, confirmationToken: preview.confirmationToken }, { vaultRoot, tokenPolicy, tokenService });
      expect(commit).toMatchObject({ status: "success", committed: true });
      expect(await readNote(vaultRoot, "Notes/Plan.md")).toContain("New section");
    });
  });

  it("fails closed when token service is unavailable", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Plan.md", "# Title\n\n## Plan\n\nOld section\n");
      const tokenPolicy = createCommitTokenPolicy();
      const tokenService = new DefaultCommitTokenService({ available: false });
      const preview = await obsidianEdit({ operation: "replace_section", path: "Notes/Plan.md", heading: "## Plan", content: "New section" }, { vaultRoot, tokenPolicy, tokenService });
      expect(preview).toMatchObject({ status: "preview", tokenRequired: true });
      expect(preview.confirmationToken).toBeUndefined();
      expect(preview.warnings.join("\n")).toMatch(/unavailable/i);

      const commit = await obsidianEdit({ operation: "replace_section", path: "Notes/Plan.md", heading: "## Plan", content: "New section", dryRun: false, confirmationToken: "ct1.payload.signature" }, { vaultRoot, tokenPolicy, tokenService });
      expect(commit).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "CONFIRMATION_TOKEN_UNAVAILABLE" } });
      expect(await readNote(vaultRoot, "Notes/Plan.md")).toContain("Old section");
    });
  });
});
