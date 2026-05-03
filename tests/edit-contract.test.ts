import { access } from "node:fs/promises";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { registerObsidianVault } from "../src/index.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { absoluteNotePath, expectNoLocalPathLeak, fakePi, readNote, registerEditTool, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_edit contract", () => {
  it("registers obsidian_edit separately with strict top-level fields", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    expect([...pi.tools.keys()]).toEqual(["obsidian_config", "obsidian_retrieve", "obsidian_validate", "obsidian_plan", "obsidian_write", "obsidian_edit", "obsidian_manage", "obsidian_destroy"]);

    const tool = pi.tools.get("obsidian_edit");
    const schema = tool.parameters;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["content", "dryRun", "heading", "newText", "oldText", "operation", "path", "property", "value"]);
    expect(Value.Check(schema, { operation: "replace_section", path: "Notes/Existing.md", heading: "## Plan", content: "New" })).toBe(true);
    expect(Value.Check(schema, { operation: "update_frontmatter", path: "Notes/Existing.md", property: "status", value: "reviewed", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "replace_exact_text", path: "Notes/Existing.md", oldText: "Old", newText: "New" })).toBe(true);
    expect(Value.Check(schema, { operation: "replace_section", path: "Notes/Existing.md", heading: "## Plan", content: "New", query: "somewhere" })).toBe(false);

    const surfaceText = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toMatch(/replace_section/);
    expect(surfaceText).toMatch(/insert_under_heading/);
    expect(surfaceText).toMatch(/update_frontmatter/);
    expect(surfaceText).toMatch(/remove_frontmatter/);
    expect(surfaceText).toMatch(/replace_exact_text/);
    expect(surfaceText).toMatch(/dryRun/i);
    expect(surfaceText).toMatch(/existing/i);
    expect(surfaceText).toMatch(/full-note overwrite/i);
  });

  it("returns structured setup_required without leaking local paths when no local vault root is configured", async () => {
    const result = await obsidianEdit({ operation: "replace_section", path: "Notes/Existing.md", heading: "## Plan", content: "New", dryRun: false }, {});
    expect(result).toMatchObject({ tool: "obsidian_edit", status: "setup_required", committed: false, error: { code: "VAULT_PATH_REQUIRED" } });
    expect(JSON.stringify(result)).not.toContain(process.cwd());
  });

  it("returns preview-default and committed success through the registered tool", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Existing.md", "# Title\n\n## Plan\n\nOld\n");
      const tool = registerEditTool(vaultRoot);
      const preview = await tool.execute("id", { operation: "replace_section", path: "Notes/Existing.md", heading: "## Plan", content: "New" });
      expect(preview.details).toMatchObject({ tool: "obsidian_edit", status: "preview", operation: "replace_section", path: "Notes/Existing.md", dryRun: true, committed: false, preview: { targetKind: "section", change: "replace" } });
      expect(preview.details.validation).toBeUndefined();
      expect(await readNote(vaultRoot, "Notes/Existing.md")).toContain("Old");

      expect(preview.details.confirmationToken).toBeUndefined();
      const commit = await tool.execute("id", { operation: "replace_section", path: "Notes/Existing.md", heading: "## Plan", content: "New", dryRun: false });
      expect(commit.details).toMatchObject({ status: "success", committed: true, target: { existsBefore: true, existsAfter: true, heading: { level: 2, text: "Plan" } } });
      expect(await readNote(vaultRoot, "Notes/Existing.md")).toContain("New");
      expectNoLocalPathLeak(commit.details, vaultRoot);

      await seedNote(vaultRoot, "Notes/Exact.md", "# Exact\n\nOld exact text.\n");
      const exactPreview = await tool.execute("id", { operation: "replace_exact_text", path: "Notes/Exact.md", oldText: "Old exact text.", newText: "New exact text." });
      expect(exactPreview.details).toMatchObject({ tool: "obsidian_edit", status: "preview", operation: "replace_exact_text", path: "Notes/Exact.md", dryRun: true, committed: false, preview: { targetKind: "exact_text", change: "replace", changedChars: 0, changedBytes: 0 } });
      expect(await readNote(vaultRoot, "Notes/Exact.md")).toContain("Old exact text.");
      expectNoLocalPathLeak(exactPreview.details, vaultRoot);
    });
  });

  it("returns deterministic target-missing/not_found without creating the note or parent directories", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianEdit({ operation: "replace_section", path: "Missing/Note.md", heading: "## Plan", content: "New", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "not_found", committed: false, error: { code: "TARGET_MISSING", category: "not_found" } });
      await expect(access(absoluteNotePath(vaultRoot, "Missing/Note.md"))).rejects.toThrow();
      await expect(access(absoluteNotePath(vaultRoot, "Missing"))).rejects.toThrow();
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("returns validation and safety outcomes for incomplete or forbidden requests", async () => {
    await withTempVault(async (vaultRoot) => {
      expect(await obsidianEdit({ path: "Notes/Existing.md", heading: "## Plan", content: "x" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_OPERATION" } });
      expect(await obsidianEdit({ operation: "replace_section", path: "Notes/Existing.md", content: "x" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_HEADING" } });
      expect(await obsidianEdit({ operation: "insert_under_heading", path: "Notes/Existing.md", heading: "## Plan", content: "  " }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "EMPTY_CONTENT" } });
      expect(await obsidianEdit({ operation: "replace_exact_text", path: "Notes/Existing.md", newText: "x" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_OLD_TEXT" } });
      expect(await obsidianEdit({ operation: "replace_exact_text", path: "Notes/Existing.md", oldText: "x" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_NEW_TEXT" } });
      expect(await obsidianEdit({ operation: "overwrite", path: "Notes/Existing.md", content: "x", dryRun: false }, { vaultRoot })).toMatchObject({ status: "safety_refusal", error: { code: "FORBIDDEN_OPERATION", category: "safety" } });
    });
  });
});
