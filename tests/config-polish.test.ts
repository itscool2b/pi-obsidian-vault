import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, statusConfigSummary } from "../src/config.js";
import { registerObsidianVault, type ObsidianRetrieveOutput } from "../src/index.js";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { executeTool, fakePi, seedNote, withTempVault } from "./write-test-utils.js";

async function withConfigFile<T>(content: Record<string, unknown>, run: (configPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-config-"));
  try {
    const configPath = path.join(dir, "obsidian-vault.json");
    await writeFile(configPath, JSON.stringify(content), "utf8");
    return await run(configPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("config polish", () => {
  it("loads safe defaults and builds a redaction-safe status summary", async () => {
    await withTempVault(async (vaultRoot) => {
      const config = await loadConfig({ env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" }, configPath: path.join(vaultRoot, "missing.json") });
      expect(config.defaultRetrieveBudget).toBe("standard");
      expect(config.defaultRelationshipBudget).toBe("standard");
      expect(config.maxPreviewChars).toBe(4000);
      expect(config.maxValidationIssues).toBe(50);
      expect(config.defaultTrashFolder).toBe("_Trash");
      expect(config.commitTokenPolicy).toMatchObject({ tokensRequired: true, strictMode: false, ttlSeconds: 300, requirementMode: "default_risky" });
      expect(config.writeDryRunValidationEnabled).toBe(true);
      expect(config.appendDryRunValidationEnabled).toBe(true);

      const summary = statusConfigSummary(config, true);
      expect(summary).toMatchObject({ tokenSupport: "enabled", tokenRequirementMode: "default_risky", tokenTtlSeconds: 300, defaultTrashFolder: "_Trash" });
      expect(JSON.stringify(summary)).not.toContain(vaultRoot);
    });
  });

  it("applies env over config, validates bounds, and warns with redacted fallback messages", async () => {
    await withTempVault(async (vaultRoot) => {
      await withConfigFile({
        defaultRetrieveBudget: "tiny",
        defaultRelationshipBudget: "expanded",
        maxPreviewChars: 200,
        maxValidationIssues: 5,
        defaultTrashFolder: "Archive/Trash",
        commitTokensRequired: false,
        commitTokenTtlSeconds: 60,
        writeDryRunValidationEnabled: false,
      }, async (configPath) => {
        const config = await loadConfig({
          configPath,
          env: {
            OBSIDIAN_VAULT_PATH: vaultRoot,
            OBSIDIAN_CLI_PATH: "obsidian-cli",
            OBSIDIAN_RETRIEVE_DEFAULT_BUDGET: "expanded",
            OBSIDIAN_MAX_PREVIEW_CHARS: "600",
            OBSIDIAN_COMMIT_TOKENS_REQUIRED: "true",
            OBSIDIAN_COMMIT_TOKEN_STRICT_MODE: "true",
            OBSIDIAN_COMMIT_TOKEN_TTL_SECONDS: "120",
            OBSIDIAN_APPEND_DRY_RUN_VALIDATION_ENABLED: "false",
          },
        });
        expect(config.defaultRetrieveBudget).toBe("expanded");
        expect(config.defaultRelationshipBudget).toBe("expanded");
        expect(config.maxPreviewChars).toBe(600);
        expect(config.maxValidationIssues).toBe(5);
        expect(config.defaultTrashFolder).toBe("Archive/Trash");
        expect(config.commitTokenPolicy).toMatchObject({ tokensRequired: true, strictMode: true, ttlSeconds: 120, requirementMode: "strict_all_mutations" });
        expect(config.writeDryRunValidationEnabled).toBe(false);
        expect(config.appendDryRunValidationEnabled).toBe(false);
      });
    });
  });

  it("falls back safely for invalid config and ignores unsafe capability flags", async () => {
    await withTempVault(async (vaultRoot) => {
      await withConfigFile({
        defaultRetrieveBudget: "huge",
        defaultRelationshipBudget: "everything",
        maxPreviewChars: 1,
        maxValidationIssues: 0,
        defaultTrashFolder: "../Trash",
        commitTokenTtlSeconds: 999999,
        commitTokenStrictMode: "maybe",
        allowOverwrite: true,
        disablePathSafety: true,
        allowShell: true,
      }, async (configPath) => {
        const config = await loadConfig({ configPath, env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" } });
        expect(config.defaultRetrieveBudget).toBe("standard");
        expect(config.defaultRelationshipBudget).toBe("standard");
        expect(config.maxPreviewChars).toBe(4000);
        expect(config.maxValidationIssues).toBe(50);
        expect(config.defaultTrashFolder).toBe("_Trash");
        expect(config.commitTokenTtlSeconds).toBe(300);
        expect(config.commitTokenStrictMode).toBe(false);
        expect(config.configWarnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(["INVALID_BUDGET", "INVALID_INTEGER", "INVALID_TRASH_FOLDER", "INVALID_BOOLEAN", "UNSAFE_CONFIG_IGNORED"]));
        expect(config.warnings.join("\n")).not.toContain(vaultRoot);
      });
    });
  });

  it("passes configured default retrieve and relationship budgets into public retrieval", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, {
        backend: seededFakeCli(),
        env: {
          OBSIDIAN_VAULT_PATH: vaultRoot,
          OBSIDIAN_CLI_PATH: "obsidian-cli",
          OBSIDIAN_RETRIEVE_DEFAULT_BUDGET: "tiny",
          OBSIDIAN_RELATIONSHIP_DEFAULT_BUDGET: "expanded",
        },
        configPath: path.join(vaultRoot, "missing-config.json"),
      });
      const search = await executeTool<ObsidianRetrieveOutput>(pi, "obsidian_retrieve", { query: "integrated gradients", mode: "search" });
      expect(search.budget.profile).toBe("tiny");
      const relationships = await executeTool<ObsidianRetrieveOutput>(pi, "obsidian_retrieve", { mode: "relationships", path: "Research/Integrated Gradients/index.md" });
      expect(relationships.budget.profile).toBe("expanded");
    });
  });

  it("applies defaultTrashFolder and dry-run validation toggles without enabling unsafe behavior", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      const trashPreview = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md" }, { vaultRoot, defaultTrashFolder: "Archive/Trash" });
      expect(trashPreview).toMatchObject({ status: "preview", trashFolder: "Archive/Trash", trashPath: "Archive/Trash/Plan.md" });

      const writePreview = await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# New\n" }, { vaultRoot, writeDryRunValidationEnabled: false });
      expect(writePreview).toMatchObject({ status: "preview" });
      expect(writePreview.validation).toBeUndefined();
      await seedNote(vaultRoot, "Notes/Append.md", "# Existing\n");
      const appendPreview = await obsidianWrite({ operation: "append", path: "Notes/Append.md", content: "More\n" }, { vaultRoot, appendDryRunValidationEnabled: false });
      expect(appendPreview.validation).toBeUndefined();
    });
  });

  it("uses maxPreviewChars only as an upper cap for existing write/edit preview helpers", async () => {
    await withTempVault(async (vaultRoot) => {
      const content = `${"A".repeat(80)}\n`;
      const writePreview = await obsidianWrite({ operation: "create", path: "Notes/New.md", content }, { vaultRoot, maxPreviewChars: 20 });
      expect(writePreview.preview?.contentPreview).toHaveLength(20);
      expect(writePreview.preview?.previewTruncated).toBe(true);

      await seedNote(vaultRoot, "Notes/Existing.md", `# Title\n\n## Plan\n\n${"B".repeat(80)}\n`);
      const editPreview = await obsidianEdit({ operation: "replace_section", path: "Notes/Existing.md", heading: "## Plan", content: "Short" }, { vaultRoot, maxPreviewChars: 20 });
      expect(editPreview.preview?.beforePreview).toHaveLength(20);
      expect(editPreview.preview?.previewTruncated).toBe(true);
    });
  });
});
