import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ObsidianCliAdapter, type CommandRunner } from "../src/obsidian-cli.js";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

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

  it("loads budget configuration and warns when retrieval signals are degraded", async () => {
    const config = await loadConfig({ env: { OBSIDIAN_VAULT_NAME: "Vault", OBSIDIAN_RETRIEVE_TINY_CHARS: "2500" } });
    expect(config.vaultTarget).toBe("Vault");
    expect(config.budgetChars.tiny).toBe(2500);

    const backend = seededFakeCli();
    backend.aliases = async () => ({ aliases: [], limited: false });
    backend.tags = async () => ({ tags: [], limited: false });
    backend.properties = async () => ({ properties: [], limited: false });
    const result = await obsidianRetrieve(backend, { query: "unknown topic", mode: "search" });
    expect(result.warnings.join("\n")).toMatch(/No candidates|metadata coverage/i);
  });
});
