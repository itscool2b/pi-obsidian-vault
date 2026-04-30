import { describe, expect, it } from "vitest";
import { ObsidianCliAdapter, type CommandRunner } from "../src/obsidian-cli.js";

function runnerWith(stdout: string): { runner: CommandRunner; calls: Array<{ command: string; args: string[]; options: unknown }> } {
  const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
  const runner: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout, stderr: "", exitCode: 0 };
  };
  return { runner, calls };
}

describe("ObsidianCliAdapter", () => {
  it("builds argv arrays with vault parameter before command and no cwd fallback when vault target is configured", async () => {
    const { runner, calls } = runnerWith(JSON.stringify({ hits: [{ path: "Note.md", score: 3 }], total: 1 }));
    const adapter = new ObsidianCliAdapter({ cliPath: "/bin/obsidian", vaultTarget: "My Vault", cwd: "/vault", runner });

    await adapter.search({ query: "integrated gradients", folder: "Research", limit: 5 });

    expect(calls[0]?.command).toBe("/bin/obsidian");
    expect(calls[0]?.args).toEqual(["vault=My Vault", "search", "query=integrated gradients", "limit=5", "format=json", "path=Research"]);
    expect(calls[0]?.options).toMatchObject({ timeoutMs: 10000, maxBytes: expect.any(Number) });
    expect(calls[0]?.options).not.toMatchObject({ cwd: "/vault" });
  });

  it("falls back to cwd when no vault target is configured", async () => {
    const { runner, calls } = runnerWith(JSON.stringify({ files: [{ path: "A.md", name: "A" }] }));
    const adapter = new ObsidianCliAdapter({ cwd: "/vault", runner });

    await adapter.files({ folder: "Projects", limit: 2 });

    expect(calls[0]?.args).toEqual(["files", "ext=md", "limit=2", "format=json", "folder=Projects"]);
    expect(calls[0]?.options).toMatchObject({ cwd: "/vault" });
  });

  it("parses files, folders, metadata commands, and search-context into bounded DTOs", async () => {
    const outputs = [
      { stdout: JSON.stringify({ files: [{ path: "A.md", name: "A", modified: "today", size: 10 }] }), stderr: "", exitCode: 0 },
      { stdout: JSON.stringify({ folders: [{ path: "Projects", noteCount: 2 }] }), stderr: "", exitCode: 0 },
      { stdout: JSON.stringify({ aliases: [{ alias: "IG", paths: ["Research/IG.md"] }] }), stderr: "", exitCode: 0 },
      { stdout: JSON.stringify({ tags: [{ tag: "attribution", count: 1, paths: ["Research/IG.md"] }] }), stderr: "", exitCode: 0 },
      { stdout: JSON.stringify({ properties: [{ name: "project", value: "Interpretability", paths: ["Research/IG.md"] }] }), stderr: "", exitCode: 0 },
      { stdout: JSON.stringify({ hits: [{ path: "Research/IG.md", line: 3, text: "integrated gradients" }] }), stderr: "", exitCode: 0 },
    ];
    const runner: CommandRunner = async () => outputs.shift() ?? { stdout: "{}", stderr: "", exitCode: 0 };
    const adapter = new ObsidianCliAdapter({ runner });

    expect(await adapter.files({ limit: 5 })).toMatchObject({ files: [{ path: "A.md", name: "A" }] });
    expect(await adapter.folders({})).toMatchObject({ folders: [{ path: "Projects", noteCount: 2 }] });
    expect(await adapter.aliases({})).toMatchObject({ aliases: [{ alias: "IG", paths: ["Research/IG.md"] }] });
    expect(await adapter.tags({ counts: true })).toMatchObject({ tags: [{ tag: "attribution", paths: ["Research/IG.md"] }] });
    expect(await adapter.properties({ counts: true })).toMatchObject({ properties: [{ name: "project", value: "Interpretability", paths: ["Research/IG.md"] }] });
    expect(await adapter.searchContext({ query: "integrated", limit: 5 })).toMatchObject({ hits: [{ path: "Research/IG.md", line: 3, text: "integrated gradients" }] });
  });

  it("parses official CLI 1.12 search arrays, search-context groups, files text, and file TSV", async () => {
    const outputs = [
      { stdout: JSON.stringify(["normal shit/System Specs.md"]), stderr: "", exitCode: 0 },
      { stdout: JSON.stringify([{ file: "normal shit/System Specs.md", matches: [{ line: 8, text: "# System Specs" }] }]), stderr: "", exitCode: 0 },
      { stdout: "normal shit/System Specs.md\nResearch/Note.md\n", stderr: "", exitCode: 0 },
      { stdout: "path\tnormal shit/System Specs.md\nname\tSystem Specs\nextension\tmd\nsize\t25037\n", stderr: "", exitCode: 0 },
    ];
    const runner: CommandRunner = async () => outputs.shift() ?? { stdout: "{}", stderr: "", exitCode: 0 };
    const adapter = new ObsidianCliAdapter({ runner });

    expect(await adapter.search({ query: "system", limit: 5 })).toMatchObject({ hits: [{ path: "normal shit/System Specs.md" }] });
    expect(await adapter.searchContext({ query: "system", limit: 5 })).toMatchObject({ hits: [{ path: "normal shit/System Specs.md", line: 8, text: "# System Specs" }] });
    expect(await adapter.files({ limit: 5 })).toMatchObject({ files: [{ path: "normal shit/System Specs.md" }, { path: "Research/Note.md" }] });
    expect(await adapter.file({ file: "System Specs" })).toMatchObject({ path: "normal shit/System Specs.md", name: "System Specs", extension: "md", size: 25037 });
  });

  it("normalizes timeouts and blocks side-effect commands", async () => {
    const timeoutRunner: CommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: true });
    const adapter = new ObsidianCliAdapter({ runner: timeoutRunner });
    await expect(adapter.search({ query: "x", limit: 1 })).rejects.toThrow(/timed out/i);
    expect(() => adapter.buildCommand(["open", "path=A.md"])).toThrow(/Blocked unsupported/);
  });
});
