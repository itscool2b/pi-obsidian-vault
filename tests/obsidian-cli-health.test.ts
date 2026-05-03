import { describe, expect, it } from "vitest";
import { loadConfig, writeStatusFromConfig } from "../src/config.js";
import path from "node:path";
import { ObsidianCliAdapter, type CommandRunner } from "../src/obsidian-cli.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { registerObsidianVault } from "../src/index.js";
import { fakePi, withTempVault } from "./write-test-utils.js";

describe("Obsidian CLI health and degraded signals", () => {
  it("reports CLI unavailable and timeout health through the adapter", async () => {
    const failingRunner: CommandRunner = async () => ({ stdout: "", stderr: "missing", exitCode: 1 });
    const adapter = new ObsidianCliAdapter({ runner: failingRunner });
    const health = await adapter.checkHealth();
    expect(health.available).toBe(false);
    expect(health.errors.join("\n")).toMatch(/missing/);

    const timeoutRunner: CommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: true });
    await expect(new ObsidianCliAdapter({ runner: timeoutRunner }).search({ query: "x", limit: 1 })).rejects.toThrow(/timed out/i);
  });

  it("reports write availability through the status command without auto-launching Obsidian", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, { env: { OBSIDIAN_VAULT_PATH: vaultRoot }, configPath: path.join(vaultRoot, "missing-config.json") });
      const messages: Array<{ message: string; level: string | undefined }> = [];
      await pi.commands.get("obsidian-vault").handler("", { ui: { notify(message: string, level?: string) { messages.push({ message, level }); } } });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain("Obsidian Vault: ready");
      expect(messages[0]?.message).toContain("Mutations: approval required");
      expect(messages[0]?.message).not.toContain(vaultRoot);
      expect(messages[0]?.level).toBe("info");
    });
  });

  it("uses hardcoded budget defaults and warns when retrieval signals are degraded", async () => {
    const config = await loadConfig({ env: {}, configPath: "/tmp/pi-obsidian-vault-health-missing.json", autoDetectVault: false });
    expect(config.budgetChars.tiny).toBe(3500);
    expect(config.autoLaunch).toBe(false);
    expect(config.launchWaitMs).toBe(4000);
    const missingWriteStatus = await writeStatusFromConfig(config);
    expect(missingWriteStatus).toMatchObject({ configured: false, writable: false });
    expect(missingWriteStatus.errors.join("\n")).toMatch(/vault path/i);

    await withTempVault(async (vaultRoot) => {
      const localConfig = await loadConfig({ env: { OBSIDIAN_VAULT_PATH: vaultRoot } });
      const localWriteStatus = await writeStatusFromConfig(localConfig);
      expect(localWriteStatus).toMatchObject({ configured: true, writable: true, vaultRoot });
    });

    const backend = seededFakeCli();
    backend.aliases = async () => ({ aliases: [], limited: false });
    backend.tags = async () => ({ tags: [], limited: false });
    backend.properties = async () => ({ properties: [], limited: false });
    const result = await obsidianRetrieve(backend, { query: "unknown topic", mode: "search" });
    expect(result.warnings.join("\n")).toMatch(/No candidates|metadata coverage/i);
  });
});
