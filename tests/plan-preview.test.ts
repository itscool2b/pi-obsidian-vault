import { describe, expect, it } from "vitest";
import { obsidianPlan } from "../src/plan-engine.js";
import { pathExists, readNote, seedFolder, seedNote, vaultSnapshot, withTempVault } from "./write-test-utils.js";

describe("obsidian_plan preview", () => {
  it("previews a valid create plan without mutating", async () => {
    await withTempVault(async (vaultRoot) => {
      const before = await vaultSnapshot(vaultRoot);
      const result = await obsidianPlan({ operations: [{ id: "create-note", tool: "obsidian_write", operation: "create", path: "Projects/Plan.md", content: "# Plan\n" }], budget: "tiny" }, { vaultRoot });
      expect(result).toMatchObject({ tool: "obsidian_plan", status: "success", valid: true, operationCount: 1 });
      expect(result.plannedEffects.notesCreated).toEqual(["Projects/Plan.md"]);
      expect(result.plannedEffects.foldersCreated).toEqual(["Projects"]);
      expect(result.summary.previewOnly).toBe(true);
      expect(await vaultSnapshot(vaultRoot)).toEqual(before);
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(false);
    });
  });

  it("models ordered virtual create, append, edit, and move effects without mutating", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFolder(vaultRoot, "Archive");
      const result = await obsidianPlan({ operations: [
        { id: "create", tool: "obsidian_write", operation: "create", path: "Projects/Plan.md", content: "# Plan\n\n## Next\nOld\n" },
        { id: "append", tool: "obsidian_write", operation: "append", path: "Projects/Plan.md", content: "\nMore" },
        { id: "edit", tool: "obsidian_edit", operation: "replace_exact_text", path: "Projects/Plan.md", oldText: "Old", newText: "New" },
        { id: "move", tool: "obsidian_manage", operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" },
      ] }, { vaultRoot });
      expect(result.valid).toBe(true);
      expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
      expect(result.plannedEffects.notesAppended).toEqual(["Projects/Plan.md"]);
      expect(result.plannedEffects.notesEdited).toEqual(["Projects/Plan.md"]);
      expect(result.plannedEffects.notesMoved).toEqual([{ fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }]);
      expect(await pathExists(vaultRoot, "Archive/Plan.md")).toBe(false);
    });
  });

  it("warns and remains valid for dryRun false when no other errors exist", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan");
      await seedFolder(vaultRoot, "Archive");
      const result = await obsidianPlan({ operations: [{ id: "copy", tool: "obsidian_manage", operation: "copy_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }] }, { vaultRoot });
      expect(result.valid).toBe(true);
      expect(result.issues).toContainEqual(expect.objectContaining({ code: "DRY_RUN_FALSE_IGNORED", severity: "warning" }));
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe("# Plan");
      expect(await pathExists(vaultRoot, "Archive/Plan.md")).toBe(false);
    });
  });
});
