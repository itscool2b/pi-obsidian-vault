import { describe, expect, it } from "vitest";
import { loadConfig, writeStatusFromConfig } from "../src/config.js";
import os from "node:os";
import path from "node:path";
import { OBSIDIAN_CLI_SETUP_INSTRUCTIONS, ObsidianCliAdapter, type CommandRunner } from "../src/obsidian-cli.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { registerObsidianVault } from "../src/index.js";
import { executeTool, fakePi, withTempVault } from "./write-test-utils.js";

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

  it("uses deterministic CLI setup guidance for a missing CLI executable without leaking raw spawn noise", async () => {
    const pi = fakePi();
    const secretCliPath = path.join(os.tmpdir(), "pi-obsidian-secret-cli", "not-registered");
    const runner: CommandRunner = async (command) => {
      const error = Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT", syscall: "spawn", path: command });
      throw error;
    };
    const backend = new ObsidianCliAdapter({ cliPath: secretCliPath, runner });
    registerObsidianVault(pi as any, { backend, env: {}, configPath: path.join(os.tmpdir(), "pi-obsidian-missing-cli-config.json"), autoDetectVault: false });

    const result = await executeTool<any>(pi, "obsidian_retrieve", { query: "anything", mode: "search" });
    const text = JSON.stringify(result);

    expect(result.candidates).toEqual([]);
    expect(text).toContain(OBSIDIAN_CLI_SETUP_INSTRUCTIONS);
    expect(result.agentGuidance.nextActions[0]).toMatchObject({ action: "configure_obsidian_cli", label: OBSIDIAN_CLI_SETUP_INSTRUCTIONS });
    expect(text).not.toContain(secretCliPath);
    expect(text).not.toMatch(/ENOENT|spawn/);
  });

  it("uses deterministic CLI setup guidance when CLI health exits because the CLI is disabled", async () => {
    const pi = fakePi();
    const calls: string[][] = [];
    const rawLocalPath = path.join(os.tmpdir(), "pi-obsidian-raw-health", "obsidian-cli");
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args);
      return { stdout: `debug stdout from ${rawLocalPath}`, stderr: "Obsidian CLI is disabled. Enable CLI in Settings > CLI and register it for PATH.", exitCode: 1 };
    };
    const backend = new ObsidianCliAdapter({ runner });
    registerObsidianVault(pi as any, { backend, env: {}, configPath: path.join(os.tmpdir(), "pi-obsidian-disabled-cli-config.json"), autoDetectVault: false });

    const result = await executeTool<any>(pi, "obsidian_retrieve", { query: "anything", mode: "search" });
    const text = JSON.stringify(result);

    expect(calls).toEqual([["version"]]);
    expect(text).toContain(OBSIDIAN_CLI_SETUP_INSTRUCTIONS);
    expect(text).not.toContain(rawLocalPath);
    expect(text).not.toContain("debug stdout");
    expect(text).not.toContain("Obsidian CLI is disabled");
  });

  it("uses deterministic CLI setup guidance when the CLI disabled message exits successfully", async () => {
    const pi = fakePi();
    const calls: string[][] = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args);
      return { stdout: "Command line interface is not enabled. Please turn it on in Settings > General > Advanced.", stderr: "", exitCode: 0 };
    };
    const backend = new ObsidianCliAdapter({ runner });
    registerObsidianVault(pi as any, { backend, env: {}, configPath: path.join(os.tmpdir(), "pi-obsidian-disabled-zero-config.json"), autoDetectVault: false });

    const result = await executeTool<any>(pi, "obsidian_retrieve", { query: "system specs", mode: "search" });
    const text = JSON.stringify(result);

    expect(calls).toEqual([["version"]]);
    expect(result.candidates).toEqual([]);
    expect(result.agentGuidance.nextActions[0]).toMatchObject({ action: "configure_obsidian_cli", label: OBSIDIAN_CLI_SETUP_INSTRUCTIONS });
    expect(text).toContain(OBSIDIAN_CLI_SETUP_INSTRUCTIONS);
    expect(text).not.toContain("No candidates found");
    expect(text).not.toContain("Command line interface is not enabled");
  });

  it("uses the same CLI setup guidance for existing-note validation while proposed-content validation remains CLI-free", async () => {
    const pi = fakePi();
    const calls: string[][] = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args);
      return { stdout: "", stderr: "Obsidian CLI is not registered on PATH. Enable CLI in Settings > CLI.", exitCode: 1 };
    };
    const backend = new ObsidianCliAdapter({ runner });
    registerObsidianVault(pi as any, { backend, env: {}, configPath: path.join(os.tmpdir(), "pi-obsidian-validation-cli-config.json"), autoDetectVault: false });

    const existing = await executeTool<any>(pi, "obsidian_validate", { target: "existing_note", path: "Notes/Test.md" });
    const existingText = JSON.stringify(existing);
    expect(existing).toMatchObject({ status: "setup_required", target: "existing_note", path: "Notes/Test.md" });
    expect(existingText).toContain(OBSIDIAN_CLI_SETUP_INSTRUCTIONS);
    expect(existingText).not.toContain("not registered on PATH");

    calls.length = 0;
    const proposed = await executeTool<any>(pi, "obsidian_validate", { target: "proposed_content", content: "# Test\n" });
    expect(proposed).toMatchObject({ status: "success", target: "proposed_content" });
    expect(calls).toEqual([]);
  });

  it("keeps backend-injected app-unavailable retrieval guidance distinct from CLI registration guidance", async () => {
    const pi = fakePi();
    const backend = seededFakeCli();
    backend.available = false;
    backend.checkHealth = async () => ({ available: false, cliPath: "obsidian", errors: ["Obsidian is not running"], warnings: [] });
    registerObsidianVault(pi as any, { backend, env: {}, configPath: path.join(os.tmpdir(), "pi-obsidian-app-unavailable-config.json"), autoDetectVault: false });

    const result = await executeTool<any>(pi, "obsidian_retrieve", { query: "anything", mode: "search" });
    const text = JSON.stringify(result);

    expect(result.candidates).toEqual([]);
    expect(result.warnings.join("\n")).toMatch(/not running|unavailable/i);
    expect(text).not.toContain(OBSIDIAN_CLI_SETUP_INSTRUCTIONS);
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
