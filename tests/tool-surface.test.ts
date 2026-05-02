import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { OBSIDIAN_RETRIEVE_BUDGETS, OBSIDIAN_RETRIEVE_MODES, OBSIDIAN_VALIDATE_TARGETS, registerObsidianVault } from "../src/index.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { PUBLIC_TOOL_NAMES, SUPPORTED_OPERATIONS } from "./release-hardening-fixtures.js";
import { requireCapabilities } from "./status-test-utils.js";

function fakePi() {
  return {
    tools: new Map<string, any>(),
    commands: new Map<string, any>(),
    registerTool(tool: any) { this.tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { this.commands.set(name, command); },
  };
}

describe("public tool surface", () => {
  it("registers obsidian_retrieve, obsidian_validate, obsidian_plan, obsidian_write, obsidian_edit, obsidian_manage, and the existing status command", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    expect([...pi.tools.keys()]).toEqual([...PUBLIC_TOOL_NAMES]);
    expect([...pi.commands.keys()]).toEqual(["obsidian-vault"]);
  });

  it("keeps the public operation matrix limited to the release-hardened surface", () => {
    expect(SUPPORTED_OPERATIONS.obsidian_write).toEqual(["create", "append", "create_folder"]);
    expect(SUPPORTED_OPERATIONS.obsidian_edit).toEqual(["replace_section", "insert_under_heading", "update_frontmatter", "remove_frontmatter", "replace_exact_text"]);
    expect(SUPPORTED_OPERATIONS.obsidian_plan).toEqual(["retrieve.note", "retrieve.relationships", "validate.existing_note", "validate.proposed_content", "write.create", "write.append", "write.create_folder", "edit.replace_section", "edit.insert_under_heading", "edit.update_frontmatter", "edit.remove_frontmatter", "edit.replace_exact_text", "manage.move_note", "manage.trash_note", "manage.restore_note", "manage.copy_note"]);
    expect(SUPPORTED_OPERATIONS.obsidian_manage).toEqual(["move_note", "trash_note", "restore_note", "copy_note"]);
  });

  it("publishes a strict, example-driven obsidian_retrieve schema without unsupported agent-style fields", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    const tool = pi.tools.get("obsidian_retrieve");
    const schema = tool.parameters;

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["budget", "explain", "includeBacklinks", "includeOutgoing", "includeSections", "maxCandidates", "maxRelated", "mode", "path", "query", "scope", "selected"]);
    expect(schema.properties.budget.enum).toEqual([...OBSIDIAN_RETRIEVE_BUDGETS]);
    expect(schema.properties.mode.enum).toEqual([...OBSIDIAN_RETRIEVE_MODES]);
    expect(schema.properties.selected.items.additionalProperties).toBe(false);
    expect(schema.properties.scope.additionalProperties).toBe(false);

    const surfaceText = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toContain('"mode":"search"');
    expect(surfaceText).toContain('"mode":"graph"');
    expect(surfaceText).toContain('"mode":"context"');
    expect(surfaceText).toContain('"mode":"note"');
    expect(surfaceText).toContain('"mode":"relationships"');
    expect(surfaceText).toContain("tiny, standard, expanded");
    expect(surfaceText).toContain("includeBacklinks");
  });

  it("publishes a strict obsidian_validate schema for existing notes and proposed content", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    const tool = pi.tools.get("obsidian_validate");
    const schema = tool.parameters;

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["budget", "content", "expectedPath", "maxIssues", "path", "target"]);
    expect(schema.properties.target.enum).toEqual([...OBSIDIAN_VALIDATE_TARGETS]);
    expect(schema.properties.budget.enum).toEqual([...OBSIDIAN_RETRIEVE_BUDGETS]);
    expect(Value.Check(schema, { target: "existing_note", path: "Projects/Plan.md" })).toBe(true);
    expect(Value.Check(schema, { target: "proposed_content", content: "# Plan", expectedPath: "Projects/Plan.md", maxIssues: 5, budget: "tiny" })).toBe(true);
    expect(Value.Check(schema, { target: "proposed_content", content: "# Plan", query: "x" })).toBe(false);
    expect(Value.Check(schema, { target: "folder", path: "Projects" })).toBe(false);
    expect(Value.Check(schema, { target: "proposed_content", content: "# Plan", maxIssues: 0 })).toBe(false);
    const surfaceText = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toMatch(/existing_note/);
    expect(surfaceText).toMatch(/proposed_content/);
    expect(surfaceText).toMatch(/workflow-neutral/i);
    expect(surfaceText).toMatch(/warning-severity advisory/i);
    expect(surfaceText).toMatch(/never creates/i);
    expect(surfaceText).not.toMatch(/template variables/i);
  });

  it("publishes a strict obsidian_plan schema for preview-only operation sequences", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    const tool = pi.tools.get("obsidian_plan");
    const schema = tool.parameters;

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["budget", "explain", "maxOperations", "operations"]);
    expect(schema.properties.operations.items.additionalProperties).toBe(false);
    expect(Value.Check(schema, { operations: [{ tool: "obsidian_retrieve", operation: "relationships", path: "Projects/Plan.md", maxRelated: 5, includeSections: true }] })).toBe(true);
    expect(Value.Check(schema, { operations: [{ tool: "obsidian_write", operation: "create", path: "Projects/Plan.md", content: "# Plan", dryRun: false }] })).toBe(true);
    expect(Value.Check(schema, { operations: [], execute: true })).toBe(false);
    const surfaceText = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toMatch(/never executes|never commits/i);
    expect(surfaceText).toMatch(/retrieve\.relationships/);
    expect(surfaceText).toMatch(/commit tokens/i);
    expect(surfaceText).toMatch(/no broad backlink scan/i);
  });

  it("publishes a strict obsidian_write schema without destination inference fields", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    const schema = pi.tools.get("obsidian_write").parameters;

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["content", "dryRun", "operation", "path"]);
    expect(Value.Check(schema, { operation: "create", path: "Notes/New.md", content: "# New" })).toBe(true);
    expect(Value.Check(schema, { operation: "append", path: "Notes/New.md", content: "More", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "create_folder", path: "Projects/New Area", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "create", path: "Notes/New.md", content: "# New", query: "somewhere" })).toBe(false);
    const surfaceText = [pi.tools.get("obsidian_write").description, pi.tools.get("obsidian_write").promptSnippet, ...(pi.tools.get("obsidian_write").promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toMatch(/dryRun/i);
    expect(surfaceText).toMatch(/explicit/i);
    expect(surfaceText).toMatch(/append/i);
    expect(surfaceText).toMatch(/create_folder/);
    expect(surfaceText).toMatch(/CONTENT_NOT_ALLOWED/);
    expect(surfaceText).toMatch(/overwrite/i);
    expect([...pi.tools.keys()]).toEqual([...PUBLIC_TOOL_NAMES]);
  });

  it("publishes a strict obsidian_edit schema without destination inference or command fields", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    const schema = pi.tools.get("obsidian_edit").parameters;

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["content", "dryRun", "heading", "newText", "oldText", "operation", "path", "property", "value"]);
    expect(Value.Check(schema, { operation: "replace_section", path: "Notes/Existing.md", heading: "## Plan", content: "New" })).toBe(true);
    expect(Value.Check(schema, { operation: "update_frontmatter", path: "Notes/Existing.md", property: "status", value: "reviewed", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "replace_exact_text", path: "Notes/Existing.md", oldText: "Old", newText: "New", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "replace_section", path: "Notes/Existing.md", heading: "## Plan", content: "New", command: "rm" })).toBe(false);
    const surfaceText = [pi.tools.get("obsidian_edit").description, pi.tools.get("obsidian_edit").promptSnippet, ...(pi.tools.get("obsidian_edit").promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toMatch(/replace_section/);
    expect(surfaceText).toMatch(/replace_exact_text/);
    expect(surfaceText).toMatch(/oldText/);
    expect(surfaceText).toMatch(/newText/);
    expect(surfaceText).toMatch(/dryRun/i);
    expect(surfaceText).toMatch(/existing/i);
    expect(surfaceText).toMatch(/create, full-note overwrite, delete, trash, restore, copy, rename, move/i);
    expect([...pi.tools.keys()]).toEqual([...PUBLIC_TOOL_NAMES]);
  });

  it("publishes a strict obsidian_manage schema for move_note, trash_note, restore_note, and copy_note only", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    const schema = pi.tools.get("obsidian_manage").parameters;

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["dryRun", "fromPath", "operation", "path", "toPath", "trashFolder", "trashPath"]);
    expect(Value.Check(schema, { operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" })).toBe(true);
    expect(Value.Check(schema, { operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "trash_note", path: "Projects/Plan.md" })).toBe(true);
    expect(Value.Check(schema, { operation: "trash_note", path: "Projects/Plan.md", trashFolder: "Archive/Trash", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md" })).toBe(true);
    expect(Value.Check(schema, { operation: "restore_note", trashPath: "Archive/Trash/Plan.md", toPath: "Projects/Plan.md", trashFolder: "Archive/Trash", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" })).toBe(true);
    expect(Value.Check(schema, { operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", content: "x" })).toBe(false);
    expect(Value.Check(schema, { operation: "trash_note", path: "Projects/Plan.md", recursive: true })).toBe(false);
    const surfaceText = [pi.tools.get("obsidian_manage").description, pi.tools.get("obsidian_manage").promptSnippet, ...(pi.tools.get("obsidian_manage").promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toMatch(/move_note/);
    expect(surfaceText).toMatch(/trash_note/);
    expect(surfaceText).toMatch(/restore_note/);
    expect(surfaceText).toMatch(/copy_note/);
    expect(surfaceText).toMatch(/fromPath/);
    expect(surfaceText).toMatch(/toPath/);
    expect(surfaceText).toMatch(/trashPath/);
    expect(surfaceText).toMatch(/trashFolder/);
    expect(surfaceText).toMatch(/_Trash/);
    expect(surfaceText).toMatch(/TRASH_TARGET_EXISTS/);
    expect(surfaceText).toMatch(/PARENT_MISSING/);
    expect(surfaceText).toMatch(/dryRun/i);
    expect(surfaceText).toMatch(/byte/i);
    expect(surfaceText).toMatch(/overwrite/i);
    expect(surfaceText).toMatch(/link/i);
  });

  it("reports obsidian_edit status without leaking vaultRoot or absolute paths", async () => {
    const pi = fakePi();
    const messages: string[] = [];
    const tempRoot = "/tmp/pi-obsidian-status-vault";
    registerObsidianVault(pi as any, { backend: seededFakeCli(), env: { OBSIDIAN_VAULT_PATH: tempRoot, OBSIDIAN_CLI_PATH: "obsidian-cli" }, configPath: "/tmp/pi-obsidian-status-missing.json" });
    await pi.commands.get("obsidian-vault").handler("", { ui: { notify(message: string) { messages.push(message); } } });
    const message = messages.join("\n");
    expect(message).toMatch(/obsidian_edit: (available|unavailable|degraded)/);
    expect(message).toMatch(/obsidian_manage: (available|unavailable|degraded)/);
    requireCapabilities(message);
    expect(message).not.toContain(tempRoot);
    expect(message).not.toMatch(/\/tmp\/pi-obsidian-status-vault/);
  });

  it("redacts absolute vault, target, and CLI paths from status output", async () => {
    const vaultRoot = mkdtempSync(path.join(os.tmpdir(), "pi-obsidian-status-vault-"));
    try {
      const pi = fakePi();
      const messages: string[] = [];
      const absoluteCliPath = path.join(os.tmpdir(), "pi-obsidian-status-cli", "obsidian-cli");
      const absoluteTargetPath = path.join(vaultRoot, "Notes", "Target.md");
      const backend = {
        async checkHealth() {
          return {
            available: false,
            cliPath: absoluteCliPath,
            errors: [`CLI failed for target ${absoluteTargetPath}`],
            warnings: [`Configured CLI path ${absoluteCliPath} could not be executed`],
          };
        },
      };

      registerObsidianVault(pi as any, { backend: backend as any, env: { OBSIDIAN_VAULT_PATH: vaultRoot, OBSIDIAN_CLI_PATH: absoluteCliPath }, configPath: path.join(vaultRoot, "missing-config.json") });
      await pi.commands.get("obsidian-vault").handler("", { ui: { notify(message: string) { messages.push(message); } } });
      const message = messages.join("\n");

      expect(message).toContain("CLI: configured absolute path redacted");
      expect(message).toMatch(/obsidian_edit: (available|unavailable|degraded)/);
      expect(message).toMatch(/obsidian_manage: (available|unavailable|degraded)/);
      requireCapabilities(message);
      expect(message).not.toContain(vaultRoot);
      expect(message).not.toContain(absoluteTargetPath);
      expect(message).not.toContain(absoluteCliPath);
      expect(message).not.toMatch(/CLI:\s*\//);
    } finally {
      rmSync(vaultRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsupported fields and unsupported budget constants at the schema level", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    const schema = pi.tools.get("obsidian_retrieve").parameters;

    for (const budget of OBSIDIAN_RETRIEVE_BUDGETS) {
      expect(Value.Check(schema, { query: "integrated gradients", mode: "search", budget })).toBe(true);
      expect(Value.Check(schema, { mode: "note", path: "Projects/Plan.md", budget })).toBe(true);
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
    expect(docs).toContain('"mode": "note"');
    expect(docs).toContain('"mode": "relationships"');
    expect(docs).toContain("obsidian_plan");
  });
});
