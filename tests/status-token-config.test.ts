import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerObsidianVault } from "../src/index.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { fakePi, runStatusCommand, withTempVault } from "./write-test-utils.js";

describe("status auto-write and simple config posture", () => {
  it("reports approval-required simple posture without leaking local paths", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot }, configPath: path.join(vaultRoot, "missing-config.json") });
      const status = await runStatusCommand(pi);
      expect(status.message).toContain("Obsidian Vault: ready");
      expect(status.message).toContain("Mutations: approval required");
      expect(status.message).toContain("Destructive mutations: destructive approval required");
      expect(status.message).toContain("Auto-write this session: disabled");
      expect(status.message).toContain("Auto-destroy this session: disabled");
      expect(status.message).toContain("Trash folder: _Trash");
      expect(status.message).not.toContain("Commit tokens:");
      expect(status.message).not.toContain("retrieveBudget=");
      expect(status.message).not.toContain(vaultRoot);
    });
  });

  it("toggles auto-write and auto-destroy for the current session through the status command", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: vaultRoot }, configPath: path.join(vaultRoot, "missing-config.json") });
      const command = pi.commands.get("obsidian-vault");
      const messages: string[] = [];
      const ctx = { ui: { notify(message: string) { messages.push(message); } } };

      await command.handler("auto-write on", ctx);
      expect(messages.at(-1)).toMatch(/enabled/i);
      expect((await runStatusCommand(pi)).message).toContain("Auto-write this session: enabled");

      await command.handler("auto-write off", ctx);
      expect(messages.at(-1)).toMatch(/disabled/i);
      expect((await runStatusCommand(pi)).message).toContain("Auto-write this session: disabled");

      await command.handler("auto-destroy on", ctx);
      expect(messages.at(-1)).toMatch(/enabled/i);
      expect((await runStatusCommand(pi)).message).toContain("Auto-destroy this session: enabled");

      await command.handler("auto-destroy off", ctx);
      expect(messages.at(-1)).toMatch(/disabled/i);
      expect((await runStatusCommand(pi)).message).toContain("Auto-destroy this session: disabled");
    });
  });

  it("ignores old config env knobs in normal status", async () => {
    await withTempVault(async (vaultRoot) => {
      const pi = fakePi();
      registerObsidianVault(pi as any, {
        backend: seededFakeCli(),
        env: {
          OBSIDIAN_VAULT_PATH: vaultRoot,
          OBSIDIAN_RETRIEVE_DEFAULT_BUDGET: "tiny",
          OBSIDIAN_MAX_PREVIEW_CHARS: "800",
          OBSIDIAN_TRASH_FOLDER: "Archive/Trash",
        },
        configPath: path.join(vaultRoot, "missing-config.json"),
      });
      const status = await runStatusCommand(pi);
      expect(status.message).toContain("Trash folder: _Trash");
      expect(status.message).not.toContain("retrieveBudget=tiny");
      expect(status.message).not.toContain("Archive/Trash");
      expect(status.message).not.toContain(vaultRoot);
    });
  });
});
