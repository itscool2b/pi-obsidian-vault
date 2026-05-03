import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { forgetRememberedVaultPath, loadConfig, rememberedVaultStatus, setRememberedVaultPath } from "../src/config.js";
import { registerObsidianVault, type ObsidianRetrieveOutput } from "../src/index.js";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { executeTool, fakePi, seedNote, withTempVault } from "./write-test-utils.js";

async function withConfigPath<T>(run: (configPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-config-"));
  try {
    return await run(path.join(dir, "obsidian-vault.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("simple vault config", () => {
  it("loads hardcoded YOLO defaults", async () => {
    await withTempVault(async (vaultRoot) => {
      const config = await loadConfig({ env: { OBSIDIAN_VAULT_PATH: vaultRoot }, configPath: path.join(vaultRoot, "missing.json") });
      expect(config.vaultPathSource).toBe("env");
      expect(config.defaultRetrieveBudget).toBe("expanded");
      expect(config.defaultRelationshipBudget).toBe("expanded");
      expect(config.maxPreviewChars).toBe(100000);
      expect(config.maxValidationIssues).toBe(50);
      expect(config.defaultTrashFolder).toBe("_Trash");
      expect(config.writeDryRunValidationEnabled).toBe(true);
      expect(config.appendDryRunValidationEnabled).toBe(true);
      expect(JSON.stringify(config.warnings)).not.toContain(vaultRoot);
    });
  });

  it("auto-detects the open Obsidian Desktop vault when no vault is remembered", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-home-"));
    const vaultA = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-auto-a-"));
    const vaultB = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-auto-b-"));
    try {
      const obsidianConfigDir = path.join(home, ".config", "obsidian");
      await mkdir(obsidianConfigDir, { recursive: true });
      await writeFile(path.join(obsidianConfigDir, "obsidian.json"), JSON.stringify({
        vaults: {
          a: { path: vaultA, open: false, ts: 1 },
          b: { path: vaultB, open: true, ts: 2 },
        },
      }), "utf8");

      const config = await loadConfig({ configPath: path.join(home, "missing.json"), homeDir: home, platform: "linux", autoDetectVault: true });
      expect(config.vaultPathSource).toBe("auto");
      expect(config.vaultRoot).toBe(vaultB);
      expect(config.rawVaultPath).toBe(vaultB);
      expect(config.errors).toEqual([]);
      expect(config.warnings.join("\n")).toMatch(/Multiple Obsidian vaults/);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(vaultA, { recursive: true, force: true });
      await rm(vaultB, { recursive: true, force: true });
    }
  });

  it("remembers, reports, and forgets one vault path", async () => {
    await withTempVault(async (vaultRoot) => {
      await withConfigPath(async (configPath) => {
        const set = await setRememberedVaultPath(vaultRoot, { configPath, autoDetectVault: false });
        expect(set).toMatchObject({ status: "success", operation: "set_vault", remembered: true, configured: true });
        expect(await readFile(configPath, "utf8")).toContain("vaultPath");

        const config = await loadConfig({ configPath, autoDetectVault: false });
        expect(config.vaultPathSource).toBe("remembered");
        expect(config.vaultRoot).toBe(vaultRoot);

        const status = await rememberedVaultStatus({ configPath, autoDetectVault: false });
        expect(status).toMatchObject({ status: "success", vaultState: "remembered", remembered: true, configured: true });

        const forget = await forgetRememberedVaultPath({ configPath, autoDetectVault: false });
        expect(forget).toMatchObject({ status: "success", remembered: false });
        const missing = await loadConfig({ configPath, autoDetectVault: false });
        expect(missing.vaultPathSource).toBe("missing");
        expect(missing.errors.join("\n")).toMatch(/couldn't find/i);
      });
    });
  });

  it("ignores old config knobs and keeps hardcoded defaults", async () => {
    await withTempVault(async (vaultRoot) => {
      await withConfigPath(async (configPath) => {
        await writeFile(configPath, JSON.stringify({
          vaultPath: vaultRoot,
          defaultRetrieveBudget: "tiny",
          maxPreviewChars: 1,
          defaultTrashFolder: "Archive/Trash",
          allowOverwrite: true,
          allowShell: true,
        }), "utf8");
        const config = await loadConfig({ configPath, autoDetectVault: false });
        expect(config.vaultPathSource).toBe("remembered");
        expect(config.defaultRetrieveBudget).toBe("expanded");
        expect(config.maxPreviewChars).toBe(100000);
        expect(config.defaultTrashFolder).toBe("_Trash");
        expect(config.warnings).toEqual([]);
      });
    });
  });

  it("uses expanded hardcoded defaults for public retrieval", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot }, configPath: path.join(vaultRoot, "missing-config.json") });
      const search = await executeTool<ObsidianRetrieveOutput>(pi, "obsidian_retrieve", { query: "integrated gradients", mode: "search" });
      expect(search.budget.profile).toBe("expanded");
      const relationships = await executeTool<ObsidianRetrieveOutput>(pi, "obsidian_retrieve", { mode: "relationships", path: "Research/Integrated Gradients/index.md" });
      expect(relationships.budget.profile).toBe("expanded");
    });
  });

  it("keeps direct engine options for internal preview caps and explicit trash folders", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      const trashPreview = await obsidianManage({ operation: "trash_note", path: "Projects/Plan.md" }, { vaultRoot, defaultTrashFolder: "Archive/Trash" });
      expect(trashPreview).toMatchObject({ status: "preview", trashFolder: "Archive/Trash", trashPath: "Archive/Trash/Plan.md" });

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
