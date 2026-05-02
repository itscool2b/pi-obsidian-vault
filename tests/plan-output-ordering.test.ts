import { describe, expect, it } from "vitest";
import { obsidianPlan } from "../src/plan-engine.js";
import { seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_plan output ordering", () => {
  it("orders issues deterministically and sets valid from error severity", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/A.md", "# A");
      await seedFolder(vaultRoot, "Archive");
      const request = { operations: [
        { id: "copy", tool: "obsidian_manage", operation: "copy_note", fromPath: "Projects/A.md", toPath: "Archive/A.md", dryRun: false },
        { id: "bad", tool: "obsidian_manage", operation: "copy_note", fromPath: "Projects/Missing.md", toPath: "Archive/Missing.md" },
      ] };
      const first = await obsidianPlan(request, { vaultRoot });
      const second = await obsidianPlan(request, { vaultRoot });
      expect(second).toEqual(first);
      expect(first.issues.map((issue) => issue.severity)).toEqual(["error", "warning"]);
      expect(first.valid).toBe(false);
    });
  });
});
