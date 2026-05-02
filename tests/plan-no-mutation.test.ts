import { describe, expect, it } from "vitest";
import { obsidianPlan } from "../src/plan-engine.js";
import { seedFolder, seedNote, vaultSnapshot, withTempVault } from "./write-test-utils.js";

describe("obsidian_plan no mutation", () => {
  it("leaves the vault unchanged for valid and invalid previews", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\nOld");
      await seedFolder(vaultRoot, "Archive");
      const before = await vaultSnapshot(vaultRoot);

      const valid = await obsidianPlan({ operations: [{ tool: "obsidian_manage", operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md" }] }, { vaultRoot });
      const invalid = await obsidianPlan({ operations: [{ tool: "obsidian_manage", operation: "move_note", fromPath: "Projects/Missing.md", toPath: "Archive/Missing.md" }] }, { vaultRoot });

      expect(valid.valid).toBe(true);
      expect(invalid.valid).toBe(false);
      expect(await vaultSnapshot(vaultRoot)).toEqual(before);
    });
  });
});
