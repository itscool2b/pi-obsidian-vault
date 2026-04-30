import { readFileSync } from "node:fs";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { OBSIDIAN_RETRIEVE_BUDGETS, registerObsidianVault } from "../src/index.js";
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

  it("publishes a strict, example-driven obsidian_retrieve schema without unsupported agent-style fields", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    const tool = pi.tools.get("obsidian_retrieve");
    const schema = tool.parameters;

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["budget", "explain", "maxCandidates", "mode", "query", "scope", "selected"]);
    expect(schema.properties.budget.enum).toEqual([...OBSIDIAN_RETRIEVE_BUDGETS]);
    expect(schema.properties.mode.enum).toEqual(["auto", "search", "context", "graph", "project"]);
    expect(schema.properties.selected.items.additionalProperties).toBe(false);
    expect(schema.properties.scope.additionalProperties).toBe(false);

    const surfaceText = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toContain('"mode":"search"');
    expect(surfaceText).toContain('"mode":"graph"');
    expect(surfaceText).toContain('"mode":"context"');
    expect(surfaceText).toContain("tiny, standard, expanded");
    expect(surfaceText).not.toContain('"include"');
  });

  it("rejects unsupported fields and unsupported budget constants at the schema level", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    const schema = pi.tools.get("obsidian_retrieve").parameters;

    for (const budget of OBSIDIAN_RETRIEVE_BUDGETS) {
      expect(Value.Check(schema, { query: "integrated gradients", mode: "search", budget })).toBe(true);
    }
    for (const budget of ["small", "large", "deep"]) {
      expect(Value.Check(schema, { query: "integrated gradients", mode: "search", budget })).toBe(false);
    }

    const includeErrors = [...Value.Errors(schema, { query: "integrated gradients", mode: "search", include: ["graph"] })];
    expect(includeErrors).toHaveLength(1);
    expect(includeErrors[0]?.message).toMatch(/additional properties/i);
    expect(includeErrors[0]?.params).toMatchObject({ additionalProperties: ["include"] });
    expect(JSON.stringify(includeErrors[0]).length).toBeLessThan(260);
  });

  it("keeps public examples focused on supported fields and budget constants", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const skill = readFileSync(new URL("../skills/obsidian-research/SKILL.md", import.meta.url), "utf8");
    const docs = `${readme}\n${skill}`;

    expect(docs).toContain("Supported top-level request fields");
    expect(docs).toContain("Valid `budget` values: `tiny`, `standard`, `expanded`.");
    expect(docs).toContain('"mode": "search"');
    expect(docs).toContain('"mode": "graph"');
    expect(docs).toContain('"mode": "context"');
    expect(docs).not.toContain('"include"');
  });
});
