import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { obsidianWrite } from "../src/write-engine.js";
import { registerObsidianVault } from "../src/index.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { fakePi, pathExists, registerWriteTool, seedFolder, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

describe("obsidian_write contract", () => {
  it("registers obsidian_write separately with strict top-level fields", async () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    expect([...pi.tools.keys()]).toEqual(["obsidian_config", "obsidian_retrieve", "obsidian_validate", "obsidian_plan", "obsidian_write", "obsidian_edit", "obsidian_manage", "obsidian_destroy"]);

    const tool = pi.tools.get("obsidian_write");
    const schema = tool.parameters;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["content", "dryRun", "folderHint", "operation", "path", "title"]);
    expect(Value.Check(schema, { operation: "create", path: "Notes/New.md", content: "# New" })).toBe(true);
    expect(Value.Check(schema, { operation: "create_folder", path: "Projects/New Area" })).toBe(true);
    expect(Value.Check(schema, { operation: "create", title: "New Note", folderHint: "Notes", content: "# New" })).toBe(true);
    expect(Value.Check(schema, { operation: "append", path: "Notes/New.md", content: "x", query: "somewhere" })).toBe(false);
    const surfaceText = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toMatch(/dryRun/i);
    expect(surfaceText).toMatch(/create folder/i);
    expect(surfaceText).toMatch(/approval|human/i);
    expect(surfaceText).toMatch(/append/i);
    expect(surfaceText).toMatch(/infer|title/i);
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

      const inferredPath = await tool.execute("id", { operation: "create", content: "# Missing path" });
      expect(inferredPath.details).toMatchObject({ status: "preview", committed: false, path: "Missing path.md" });

      await seedFolder(vaultRoot, "Folders/Existing");
      const folderConflict = await tool.execute("id", { operation: "create_folder", path: "Folders/Existing", dryRun: false });
      expect(folderConflict.details).toMatchObject({ status: "conflict", operation: "create_folder", committed: false, error: { code: "TARGET_FOLDER_EXISTS" } });
      expect(folderConflict.details.nextActions.map((action: any) => action.action)).toContain("choose_different_path");
    });
  });

  it("asks for human approval inside the tool before committing natural write requests", async () => {
    await withTempVault(async (vaultRoot) => {
      const tool = registerWriteTool(vaultRoot);
      const prompts: string[] = [];
      const denied = await tool.execute("id", { operation: "create", title: "Approval Check", content: "# Approval Check\n" }, undefined, undefined, { ui: { confirm(_title: string, message: string) { prompts.push(message); return false; } } });
      expect(denied.details).toMatchObject({ status: "preview", committed: false, message: "Cancelled by user; no Obsidian vault changes were made." });
      expect(prompts[0]).toContain("Approval Check.md");
      expect(await pathExists(vaultRoot, "Approval Check.md")).toBe(false);

      const approved = await tool.execute("id", { operation: "create", title: "Approval Check", content: "# Approval Check\n" }, undefined, undefined, { ui: { confirm() { return true; } } });
      expect(approved.details).toMatchObject({ status: "success", committed: true, path: "Approval Check.md" });
      expect(await pathExists(vaultRoot, "Approval Check.md")).toBe(true);
    });
  });

  it("supports Auto-write this session and skips later approval prompts", async () => {
    await withTempVault(async (vaultRoot) => {
      const tool = registerWriteTool(vaultRoot);
      let selectCalls = 0;
      const enabled = await tool.execute("id", { operation: "create", title: "Auto Write One", content: "# Auto Write One\n" }, undefined, undefined, {
        ui: {
          select(_title: string, options: string[]) {
            selectCalls += 1;
            expect(options).toEqual(["Yes", "No", "Auto-write this session"]);
            return "Auto-write this session";
          },
        },
      });
      expect(enabled.details).toMatchObject({ status: "success", committed: true, path: "Auto Write One.md" });
      expect(enabled.details.warnings.join("\n")).toMatch(/Auto-write enabled/i);
      expect(selectCalls).toBe(1);

      const skippedPrompt = await tool.execute("id", { operation: "create", title: "Auto Write Two", content: "# Auto Write Two\n" });
      expect(skippedPrompt.details).toMatchObject({ status: "success", committed: true, path: "Auto Write Two.md" });
      expect(skippedPrompt.details.warnings.join("\n")).toMatch(/approval prompt was skipped/i);
      expect(selectCalls).toBe(1);

      const dryRun = await tool.execute("id", { operation: "create", title: "Auto Write Dry Run", content: "# Auto Write Dry Run\n", dryRun: true });
      expect(dryRun.details).toMatchObject({ status: "preview", committed: false, path: "Auto Write Dry Run.md" });
      expect(await pathExists(vaultRoot, "Auto Write Dry Run.md")).toBe(false);
    });
  });

  it("returns structured append, missing-target, preview-default, and no-leak outcomes", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Existing.md", "# Existing");
      const append = await obsidianWrite({ operation: "append", path: "Notes/Existing.md", content: "\nAppended", dryRun: false }, { vaultRoot });
      expect(append).toMatchObject({ status: "success", operation: "append", path: "Notes/Existing.md", dryRun: false, committed: true });
      expect(append.validation).toBeUndefined();

      const missing = await obsidianWrite({ operation: "append", path: "Notes/Missing.md", content: "x", dryRun: false }, { vaultRoot });
      expect(missing).toMatchObject({ status: "missing_target", error: { code: "TARGET_MISSING" }, committed: false });
      expect(missing.nextActions.map((action) => action.action)).toContain("retry_with_create");

      const preview = await obsidianWrite({ operation: "create", path: "Notes/Preview.md", content: "x" }, { vaultRoot });
      expect(preview).toMatchObject({ status: "preview", dryRun: true, committed: false, preview: { wouldCreate: true, contentChars: 1 }, validation: { target: "proposed_content", expectedPath: "Notes/Preview.md", summary: { checkedScope: "write_create_content" } } });
      expect(preview.nextActions.map((action) => action.action)).toContain("confirm_preview");

      const folderPreview = await obsidianWrite({ operation: "create_folder", path: "Folders/Preview" }, { vaultRoot });
      expect(folderPreview).toMatchObject({ status: "preview", operation: "create_folder", dryRun: true, committed: false, preview: { targetKind: "folder", wouldCreateFolder: true } });
      expect(folderPreview.preview).not.toHaveProperty("contentPreview");
      expect(folderPreview.validation).toBeUndefined();

      for (const result of [append, missing, preview, folderPreview]) {
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

      const folderContent = await obsidianWrite({ operation: "create_folder", path: "Folders/With Content", content: "x", dryRun: false }, { vaultRoot });
      expect(folderContent).toMatchObject({ status: "validation_error", error: { code: "CONTENT_NOT_ALLOWED", category: "validation" }, committed: false });
    });
  });

  it("returns setup_required without leaking local paths when no local vault root is configured", async () => {
    const result = await obsidianWrite({ operation: "create", path: "Notes/New.md", content: "# New", dryRun: false }, {});
    expect(result).toMatchObject({ status: "setup_required", committed: false, error: { code: "VAULT_PATH_REQUIRED" } });
    expect(JSON.stringify(result)).not.toContain(process.cwd());
  });
});
