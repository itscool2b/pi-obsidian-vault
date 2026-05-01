import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { registerObsidianVault } from "../src/index.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";
import { expectNoLocalPathLeak, fakePi, registerManageTool, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage contract", () => {
  it("registers obsidian_manage separately with strict top-level fields", () => {
    const pi = fakePi();
    registerObsidianVault(pi as any, { backend: seededFakeCli() });
    expect([...pi.tools.keys()]).toEqual(["obsidian_retrieve", "obsidian_write", "obsidian_edit", "obsidian_manage"]);

    const tool = pi.tools.get("obsidian_manage");
    const schema = tool.parameters;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["dryRun", "fromPath", "operation", "path", "toPath", "trashFolder", "trashPath"]);
    expect(Value.Check(schema, { operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" })).toBe(true);
    expect(Value.Check(schema, { operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "trash_note", path: "Projects/Plan.md" })).toBe(true);
    expect(Value.Check(schema, { operation: "trash_note", path: "Projects/Plan.md", trashFolder: "Archive/Trash", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md" })).toBe(true);
    expect(Value.Check(schema, { operation: "restore_note", trashPath: "Archive/Trash/Plan.md", toPath: "Projects/Plan.md", trashFolder: "Archive/Trash", dryRun: false })).toBe(true);
    expect(Value.Check(schema, { operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", content: "x" })).toBe(false);
    expect(Value.Check(schema, { operation: "trash_note", path: "Projects/Plan.md", recursive: true })).toBe(false);

    const surfaceText = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n");
    expect(surfaceText).toMatch(/move_note/);
    expect(surfaceText).toMatch(/trash_note/);
    expect(surfaceText).toMatch(/restore_note/);
    expect(surfaceText).toMatch(/fromPath/);
    expect(surfaceText).toMatch(/toPath/);
    expect(surfaceText).toMatch(/trashPath/);
    expect(surfaceText).toMatch(/trashFolder/);
    expect(surfaceText).toMatch(/_Trash/);
    expect(surfaceText).toMatch(/dryRun/i);
    expect(surfaceText).toMatch(/PARENT_MISSING/);
    expect(surfaceText).toMatch(/TRASH_TARGET_EXISTS/);
    expect(surfaceText).toMatch(/PARENT_MISSING/);
    expect(surfaceText).toMatch(/overwrite/i);
    expect(surfaceText).toMatch(/folder moves/i);
    expect(surfaceText).not.toContain('"query"');
  });

  it("returns structured preview and committed success through the registered tool", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      await seedFolder(vaultRoot, "Archive");
      const tool = registerManageTool(vaultRoot);

      const preview = await tool.execute("id", { operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" });
      expect(preview.details).toMatchObject({ tool: "obsidian_manage", status: "preview", operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: true, committed: false, preview: { wouldMove: true } });
      expect(preview.content[0].text).toContain('"status": "preview"');
      expectNoLocalPathLeak(preview.details, vaultRoot);

      const commit = await tool.execute("id", { operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false });
      expect(commit.details).toMatchObject({ status: "success", dryRun: false, committed: true, target: { sourceExistsAfter: false, destinationExistsAfter: true } });
      expectNoLocalPathLeak(commit.details, vaultRoot);
    });
  });

  it("returns structured trash_note preview and committed success through the registered tool", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      const tool = registerManageTool(vaultRoot);

      const preview = await tool.execute("id", { operation: "trash_note", path: "Projects/Plan.md" });
      expect(preview.details).toMatchObject({ tool: "obsidian_manage", status: "preview", operation: "trash_note", path: "Projects/Plan.md", trashFolder: "_Trash", trashPath: "_Trash/Plan.md", dryRun: true, committed: false, preview: { wouldTrash: true, wouldPermanentlyDelete: false } });
      expect(preview.content[0].text).toContain('"operation": "trash_note"');
      expectNoLocalPathLeak(preview.details, vaultRoot);

      const commit = await tool.execute("id", { operation: "trash_note", path: "Projects/Plan.md", dryRun: false });
      expect(commit.details).toMatchObject({ status: "success", dryRun: false, committed: true, trashPath: "_Trash/Plan.md", target: { sourceExistsAfter: false, trashTargetExistsAfter: true } });
      expectNoLocalPathLeak(commit.details, vaultRoot);
    });
  });

  it("returns structured restore_note preview and committed success through the registered tool", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Plan.md", "# Plan\n");
      await seedFolder(vaultRoot, "Projects");
      const tool = registerManageTool(vaultRoot);

      const preview = await tool.execute("id", { operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md" });
      expect(preview.details).toMatchObject({ tool: "obsidian_manage", status: "preview", operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", trashFolder: "_Trash", dryRun: true, committed: false, preview: { wouldRestore: true, wouldPermanentlyDelete: false, wouldCreateParent: false } });
      expect(preview.content[0].text).toContain('"operation": "restore_note"');
      expectNoLocalPathLeak(preview.details, vaultRoot);

      const commit = await tool.execute("id", { operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", dryRun: false });
      expect(commit.details).toMatchObject({ status: "success", dryRun: false, committed: true, trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", target: { trashSourceExistsAfter: false, destinationExistsAfter: true } });
      expectNoLocalPathLeak(commit.details, vaultRoot);
    });
  });

  it("returns validation, safety, not_found, conflict, and setup outcomes", async () => {
    await withTempVault(async (vaultRoot) => {
      expect(await obsidianManage({ fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_OPERATION" } });
      expect(await obsidianManage({ operation: "move_note", toPath: "Archive/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_FROM_PATH" } });
      expect(await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_TO_PATH" } });
      expect(await obsidianManage({ operation: "delete", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot })).toMatchObject({ status: "safety_refusal", error: { code: "FORBIDDEN_OPERATION" } });
      expect(await obsidianManage({ operation: "trash_note", dryRun: false }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_PATH" } });
      expect(await obsidianManage({ operation: "trash_note", path: "Projects/Plan.txt", dryRun: false }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "SOURCE_NOT_MARKDOWN" } });
      expect(await obsidianManage({ operation: "restore_note", toPath: "Projects/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_TRASH_PATH" } });
      expect(await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_TO_PATH" } });
      expect(await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.txt", toPath: "Projects/Plan.md" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "TRASH_SOURCE_NOT_MARKDOWN" } });
      expect(await obsidianManage({ operation: "restore_note", trashPath: "OtherTrash/Plan.md", toPath: "Projects/Plan.md" }, { vaultRoot })).toMatchObject({ status: "safety_refusal", error: { code: "TRASH_PATH_OUTSIDE_TRASH" } });
      expect(await obsidianManage({ operation: "move_note", fromPath: "Projects/Missing.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot })).toMatchObject({ status: "not_found", error: { code: "SOURCE_NOT_FOUND" } });

      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      await seedNote(vaultRoot, "Archive/Plan.md", "# Existing\n");
      await seedNote(vaultRoot, "_Trash/Plan.md", "# Trashed\n");
      expect(await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot })).toMatchObject({ status: "conflict", error: { code: "TARGET_EXISTS" } });
      expect(await obsidianManage({ operation: "restore_note", trashPath: "_Trash/Plan.md", toPath: "Projects/Plan.md", dryRun: false }, { vaultRoot })).toMatchObject({ status: "conflict", error: { code: "TARGET_EXISTS" } });
    });

    const setup = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, {});
    expect(setup).toMatchObject({ status: "setup_required", committed: false, error: { code: "VAULT_PATH_REQUIRED" } });
    expect(JSON.stringify(setup)).not.toContain(process.cwd());
  });
});
