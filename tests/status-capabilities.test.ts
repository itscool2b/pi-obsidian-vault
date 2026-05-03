import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerObsidianVault } from "../src/index.js";
import { fakePi, runStatusCommand, withTempVault } from "./write-test-utils.js";
import { expectNoAbsolutePathFragments } from "./status-test-utils.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("/obsidian-vault simple status", () => {
  it("shows a dead-simple ready status for a healthy local temp vault", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot }, configPath: path.join(vaultRoot, "missing-config.json") });
      const status = await runStatusCommand(pi);
      expect(status.level).toBe("info");
      expect(status.message).toContain("Obsidian Vault: ready");
      expect(status.message).toContain("Vault: dev override");
      expect(status.message).toContain("Mutations: approval required");
      expect(status.message).toContain("Destructive mutations: destructive approval required");
      expect(status.message).toContain("Auto-write this session: disabled");
      expect(status.message).toContain("Auto-destroy this session: disabled");
      expect(status.message).toContain("Trash folder: _Trash");
      expectNoAbsolutePathFragments(status.message, [vaultRoot]);
    });
  });

  it("shows setup-needed guidance when no vault is available", async () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli(), env: {}, configPath: path.join(process.cwd(), "definitely-missing-status.json"), autoDetectVault: false });
    const status = await runStatusCommand(pi);
    expect(status.level).toBe("warning");
    expect(status.message).toContain("Obsidian Vault: setup needed");
    expect(status.message).toContain("Vault: missing");
    expect(status.message).toContain("Tell me your Obsidian vault folder path and I can remember it.");
  });

  it("reports session auto-write and auto-destroy in simple status", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot }, configPath: path.join(vaultRoot, "missing-config.json") });
      const command = pi.commands.get("obsidian-vault");
      await command.handler("auto-write on", { ui: { notify() {} } });
      await command.handler("auto-destroy on", { ui: { notify() {} } });
      const status = await runStatusCommand(pi);
      expect(status.message).toContain("Mutations: auto-write this session");
      expect(status.message).toContain("Destructive mutations: auto-destroy this session");
      expect(status.message).toContain("Auto-write this session: enabled");
      expect(status.message).toContain("Auto-destroy this session: enabled");
    });
  });
});
