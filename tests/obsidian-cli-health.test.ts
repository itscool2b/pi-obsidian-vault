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
      registerObsidianVault(pi as any, { env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: "/bin/true", OBSIDIAN_AUTO_LAUNCH: "true" }, configPath: path.join(vaultRoot, "missing-config.json") });
      const messages: Array<{ message: string; level: string | undefined }> = [];
      await pi.commands.get("obsidian-vault").handler("", { ui: { notify(message: string, level?: string) { messages.push({ message, level }); } } });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain("Writes: available");
      expect(messages[0]?.message).toContain("CLI: configured absolute path redacted");
      expect(messages[0]?.message).not.toContain("/bin/true");
      expect(messages[0]?.level).toBe("info");
    });
  });

  it("loads budget configuration and warns when retrieval signals are degraded", async () => {
    const config = await loadConfig({ env: { OBSIDIAN_VAULT_NAME: "Vault", OBSIDIAN_RETRIEVE_TINY_CHARS: "2500", OBSIDIAN_AUTO_LAUNCH: "false", OBSIDIAN_LAUNCH_WAIT_MS: "750" }, configPath: "/tmp/pi-obsidian-vault-health-missing.json" });
    expect(config.vaultTarget).toBe("Vault");
    expect(config.budgetChars.tiny).toBe(2500);
    expect(config.autoLaunch).toBe(false);
    expect(config.launchWaitMs).toBe(750);
    const targetOnlyWriteStatus = await writeStatusFromConfig(config);
    expect(targetOnlyWriteStatus).toMatchObject({ configured: false, writable: false });
    expect(targetOnlyWriteStatus.warnings.join("\n")).toMatch(/local vaultPath/i);

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
