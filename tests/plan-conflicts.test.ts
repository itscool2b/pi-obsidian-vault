import { describe, expect, it } from "vitest";
import { obsidianPlan } from "../src/plan-engine.js";
import { seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_plan conflict detection", () => {
  it("detects duplicate ids, duplicate destinations, missing sources, existing targets, and missing parents", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/A.md", "# A");
      await seedNote(vaultRoot, "Archive/Existing.md", "# Existing");
      await seedFolder(vaultRoot, "Archive");
      const result = await obsidianPlan({ operations: [
        { id: "dup", tool: "obsidian_manage", operation: "copy_note", fromPath: "Projects/A.md", toPath: "Archive/Same.md" },
        { id: "dup", tool: "obsidian_manage", operation: "copy_note", fromPath: "Projects/A.md", toPath: "Archive/Same.md" },
        { id: "missing", tool: "obsidian_manage", operation: "copy_note", fromPath: "Projects/Missing.md", toPath: "Archive/Missing.md" },
        { id: "exists", tool: "obsidian_manage", operation: "copy_note", fromPath: "Projects/A.md", toPath: "Archive/Existing.md" },
        { id: "parent", tool: "obsidian_manage", operation: "copy_note", fromPath: "Projects/A.md", toPath: "Missing/Parent.md" },
      ] }, { vaultRoot });
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_OPERATION_ID" }),
        expect.objectContaining({ code: "DUPLICATE_DESTINATION" }),
        expect.objectContaining({ code: "SOURCE_NOT_FOUND", operationId: "missing" }),
        expect.objectContaining({ code: "TARGET_EXISTS", operationId: "exists" }),
        expect.objectContaining({ code: "PARENT_MISSING", operationId: "parent" }),
      ]));
      expect(result.conflicts.length).toBeGreaterThan(0);
    });
  });

  it("detects append-after-move old path and edit-after-trash ordering hazards", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/A.md", "# A\nOld");
      await seedNote(vaultRoot, "Projects/B.md", "# B\nOld");
      await seedFolder(vaultRoot, "Archive");
      const result = await obsidianPlan({ operations: [
        { id: "move", tool: "obsidian_manage", operation: "move_note", fromPath: "Projects/A.md", toPath: "Archive/A.md" },
        { id: "append-old", tool: "obsidian_write", operation: "append", path: "Projects/A.md", content: "more" },
        { id: "trash", tool: "obsidian_manage", operation: "trash_note", path: "Projects/B.md" },
        { id: "edit-trash", tool: "obsidian_edit", operation: "replace_exact_text", path: "Projects/B.md", oldText: "Old", newText: "New" },
      ] }, { vaultRoot });
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "APPEND_AFTER_MOVE_OLD_PATH", operationId: "append-old" }),
        expect.objectContaining({ code: "EDIT_AFTER_TRASH", operationId: "edit-trash" }),
      ]));
    });
  });

  it("keeps warning-only plans valid", async () => {
    const result = await obsidianPlan({ operations: [{ id: "read", tool: "obsidian_retrieve", operation: "note", path: "Projects/Plan.md", dryRun: false }] });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "DRY_RUN_FALSE_IGNORED", severity: "warning" }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "CHECK_UNAVAILABLE", severity: "warning" }));
    expect(result.valid).toBe(true);
  });
});
