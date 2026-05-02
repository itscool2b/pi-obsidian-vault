import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerObsidianVault } from "../src/index.js";
import { fakePi, runStatusCommand, withTempVault } from "./write-test-utils.js";
import { requireCapabilities, expectNoAbsolutePathFragments } from "./status-test-utils.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("/obsidian-vault capability status", () => {
  it("shows retrieve, write, edit, manage, and plan as available for a healthy local temp vault", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" }, configPath: path.join(vaultRoot, "missing-config.json") });
      const status = await runStatusCommand(pi);
      const capabilities = requireCapabilities(status.message);
      expect(capabilities).toEqual({ retrieve: "available", write: "available", edit: "available", manage: "available", plan: "available" });
      expect(status.level).toBe("info");
      expect(status.message).toContain("Capabilities:");
      expectNoAbsolutePathFragments(status.message, [vaultRoot]);
    });
  });

  it("shows degraded or unavailable states clearly when retrieval or local mutation setup is unavailable", async () => {
    const pi = fakePi();
    const backend = seededFakeCli();
    backend.checkHealth = async () => ({ available: false, cliPath: "obsidian-cli", errors: ["Obsidian CLI unavailable"], warnings: [] });
    registerObsidianVault(pi as any, { backend, env: {}, configPath: path.join(os.tmpdir(), "pi-obsidian-status-missing.json") });
    const status = await runStatusCommand(pi);
    const capabilities = requireCapabilities(status.message);
    expect(capabilities.retrieve).toBe("unavailable");
    expect(capabilities.write).toBe("unavailable");
    expect(capabilities.edit).toBe("unavailable");
    expect(capabilities.manage).toBe("unavailable");
    expect(capabilities.plan).toBe("unavailable");
    expect(status.level).toBe("warning");
    expect(status.message).toMatch(/unavailable/);
  });

  it("reports retrieve as degraded when health warnings are present while local mutation tools remain available", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      const backend = seededFakeCli();
      backend.checkHealth = async () => ({ available: true, cliPath: "obsidian-cli", errors: [], warnings: ["metadata cache is warming"] });
      registerObsidianVault(pi as any, { backend, env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" }, configPath: path.join(vaultRoot, "missing-config.json") });
      const status = await runStatusCommand(pi);
      const capabilities = requireCapabilities(status.message);
      expect(capabilities).toMatchObject({ retrieve: "degraded", write: "available", edit: "available", manage: "available", plan: "available" });
      expect(status.level).toBe("warning");
      expect(status.message).toContain("Warning: metadata cache is warming");
      expectNoAbsolutePathFragments(status.message, [vaultRoot]);
    });
  });

  it("redacts absolute CLI paths, vault paths, config paths, errors, and warnings", async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-status-cap-"));
    try {
      const absoluteCliPath = path.join(vaultRoot, "bin", "obsidian-cli");
      const configPath = path.join(vaultRoot, "config", "obsidian-vault.json");
      const targetPath = path.join(vaultRoot, "Notes", "Target.md");
      const pi = fakePi();
      const backend = {
        async checkHealth() {
          return {
            available: false,
            cliPath: absoluteCliPath,
            errors: [`Failed to inspect ${targetPath} using ${absoluteCliPath}`],
            warnings: [`Config path ${configPath} referenced ${vaultRoot}`],
          };
        },
      };
      registerObsidianVault(pi as any, { backend: backend as any, env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: absoluteCliPath }, configPath });
      const status = await runStatusCommand(pi);
      requireCapabilities(status.message);
      expect(status.message).toContain("CLI: configured absolute path redacted");
      expectNoAbsolutePathFragments(status.message, [vaultRoot, absoluteCliPath, configPath, targetPath]);
      expect(status.message).toContain("[path]");
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});
