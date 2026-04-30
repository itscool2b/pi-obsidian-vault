import { describe, expect, it } from "vitest";
import { registerObsidianVault } from "../src/index.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

function fakePi() {
  return {
    tools: new Map<string, any>(),
    commands: new Map<string, any>(),
    registerTool(tool: any) { this.tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { this.commands.set(name, command); },
  };
}

describe("public tool surface", () => {
  it("registers only obsidian_retrieve and the existing status command", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    expect([...pi.tools.keys()]).toEqual(["obsidian_retrieve"]);
    expect([...pi.commands.keys()]).toEqual(["obsidian-vault"]);
  });
});
