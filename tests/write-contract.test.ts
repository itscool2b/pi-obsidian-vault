import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { obsidianWrite } from "../src/write-engine.js";
import { registerObsidianVault } from "../src/index.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { fakePi, registerWriteTool, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

describe("obsidian_write contract", () => {
  it("registers obsidian_write separately with strict top-level fields", async () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    expect([...pi.tools.keys()]).toEqual(["obsidian_retrieve", "obsidian_write"]);

    const tool = pi.tools.get("obsidian_write");
    const schema = tool.parameters;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["content", "dryRun", "operation", "path"]);
    expect(Value.Check(schema, { operation: "create", path: "Notes/New.md", content: "# New" })).toBe(true);
    expect(Value.Check(schema, { operation: "append", path: "Notes/New.md", content: "x", query: "somewhere" })).toBe(false);
    const surfaceText = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toMatch(/dryRun/i);
    expect(surfaceText).toMatch(/create/i);
    expect(surfaceText).toMatch(/append/i);
    expect(surfaceText).not.toContain('"query"');
  });

  it("returns structured create success, conflict, and missing-path outcomes", async () => {
    await withTempVault(async (vaultRoot) => {
      const tool = registerWriteTool(vaultRoot);
      const create = await tool.execute("id", { operation: "create", path: "Notes/New.md", content: "# New", dryRun: false });
      expect(create.details).toMatchObject({ tool: "obsidian_write", status: "success", operation: "create", path: "Notes/New.md", dryRun: false, committed: true, target: { existsBefore: false, existsAfter: true } });
      expect(create.content[0].text).toContain('"status": "success"');

      const conflict = await tool.execute("id", { operation: "create", path: "Notes/New.md", content: "# Replacement", dryRun: false });
      expect(conflict.details).toMatchObject({ status: "conflict", committed: false, error: { code: "TARGET_EXISTS" } });
      expect(conflict.details.nextActions.map((action: any) => action.action)).toEqual(expect.arrayContaining(["choose_different_path", "retry_with_append"]));

      const missingPath = await tool.execute("id", { operation: "create", content: "# Missing path" });
      expect(missingPath.details).toMatchObject({ status: "validation_error", committed: false, error: { code: "MISSING_PATH" } });
    });
  });

  it("returns structured append, missing-target, preview-default, and no-leak outcomes", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Existing.md", "# Existing");
      const append = await obsidianWrite({ operation: "append", path: "Notes/Existing.md", content: "\nAppended", dryRun: false }, { vaultRoot });
      expect(append).toMatchObject({ status: "success", operation: "append", path: "Notes/Existing.md", dryRun: false, committed: true });

      const missing = await obsidianWrite({ operation: "append", path: "Notes/Missing.md", content: "x", dryRun: false }, { vaultRoot });
      expect(missing).toMatchObject({ status: "missing_target", error: { code: "TARGET_MISSING" }, committed: false });
      expect(missing.nextActions.map((action) => action.action)).toContain("retry_with_create");

      const preview = await obsidianWrite({ operation: "create", path: "Notes/Preview.md", content: "x" }, { vaultRoot });
      expect(preview).toMatchObject({ status: "preview", dryRun: true, committed: false, preview: { wouldCreate: true, contentChars: 1 } });
      expect(preview.nextActions.map((action) => action.action)).toContain("confirm_preview");

      for (const result of [append, missing, preview]) {
        const text = stringifyDetails(result);
        expect(text).not.toContain(vaultRoot);
        expect(text).not.toMatch(/\/tmp\/pi-obsidian-write-/);
      }
    });
  });

  it("returns validation and safety outcomes for incomplete, empty, or unsupported requests", async () => {
    await withTempVault(async (vaultRoot) => {
      const missingOperation = await obsidianWrite({ path: "Notes/New.md", content: "x" }, { vaultRoot });
      expect(missingOperation).toMatchObject({ status: "validation_error", error: { code: "MISSING_OPERATION" }, committed: false });

      const emptyContent = await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "  \n", dryRun: false }, { vaultRoot });
      expect(emptyContent).toMatchObject({ status: "validation_error", error: { code: "EMPTY_CONTENT" }, committed: false });

      const unsupported = await obsidianWrite({ operation: "upsert", path: "Notes/New.md", content: "x", dryRun: false }, { vaultRoot });
      expect(unsupported).toMatchObject({ status: "safety_refusal", error: { code: "UNSUPPORTED_OPERATION", category: "safety" }, committed: false });
    });
  });

  it("returns setup_required without leaking local paths when no local vault root is configured", async () => {
    const result = await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# New", dryRun: false }, {});
    expect(result).toMatchObject({ status: "setup_required", committed: false, error: { code: "VAULT_PATH_REQUIRED" } });
    expect(JSON.stringify(result)).not.toContain(process.cwd());
  });
});
