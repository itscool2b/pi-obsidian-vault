import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerObsidianVault } from "../src/index.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { fakePi, runStatusCommand, withTempVault } from "./write-test-utils.js";

describe("status token/config posture", () => {
  it("reports default token and config posture without leaking local paths", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" }, configPath: path.join(vaultRoot, "missing-config.json") });
      const status = await runStatusCommand(pi);
      expect(status.message).toContain("Commit tokens: enabled (default_risky, ttl 300s)");
      expect(status.message).toContain("retrieveBudget=standard");
      expect(status.message).toContain("relationshipBudget=standard");
      expect(status.message).toContain("maxPreviewChars=4000");
      expect(status.message).toContain("maxValidationIssues=50");
      expect(status.message).toContain("trashFolder=_Trash");
      expect(status.message).toContain("Dry-run validation: create=enabled, append=enabled");
      expect(status.message).not.toContain(vaultRoot);
    });
  });

  it("reports env-overridden strict token posture and safe config toggles", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, {
        backend: seededFakeCli(),
        env: {
          OBSIDIAN_VAULT_PATH: vaultRoot,
          OBSIDIAN_CLI_PATH: "obsidian-cli",
          OBSIDIAN_COMMIT_TOKEN_STRICT_MODE: "true",
          OBSIDIAN_COMMIT_TOKEN_TTL_SECONDS: "120",
          OBSIDIAN_RETRIEVE_DEFAULT_BUDGET: "tiny",
          OBSIDIAN_RELATIONSHIP_DEFAULT_BUDGET: "expanded",
          OBSIDIAN_MAX_PREVIEW_CHARS: "800",
          OBSIDIAN_VALIDATE_MAX_ISSUES: "7",
          OBSIDIAN_TRASH_FOLDER: "Archive/Trash",
          OBSIDIAN_WRITE_DRY_RUN_VALIDATION_ENABLED: "false",
          OBSIDIAN_APPEND_DRY_RUN_VALIDATION_ENABLED: "false",
        },
        configPath: path.join(vaultRoot, "missing-config.json"),
      });
      const status = await runStatusCommand(pi);
      expect(status.message).toContain("Commit tokens: enabled (strict_all_mutations, ttl 120s)");
      expect(status.message).toContain("retrieveBudget=tiny");
      expect(status.message).toContain("relationshipBudget=expanded");
      expect(status.message).toContain("maxPreviewChars=800");
      expect(status.message).toContain("maxValidationIssues=7");
      expect(status.message).toContain("trashFolder=Archive/Trash");
      expect(status.message).toContain("Dry-run validation: create=disabled, append=disabled");
      expect(status.message).not.toContain(vaultRoot);
    });
  });
});
