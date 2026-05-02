import { describe, expect, it } from "vitest";
import { obsidianWrite } from "../src/write-engine.js";
import { expectNoteUnchanged, pathExists, readNote, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_write dry-run validation metadata", () => {
  it("includes advisory validation metadata for create dry-runs", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "create", path: "Projects/Plan.md", content: "# Different\nSee [broken](../Secrets.md)." }, { vaultRoot });

      expect(result).toMatchObject({ status: "preview", operation: "create", dryRun: true, committed: false, validation: { target: "proposed_content", expectedPath: "Projects/Plan.md", summary: { checkedScope: "write_create_content" } } });
      expect(result.validation?.valid).toBe(true);
      expect(result.validation?.issues.find((issue) => issue.code === "SUSPICIOUS_TRAVERSAL_PATH")?.severity).toBe("warning");
      expect(result.validation?.issues.map((issue) => issue.code)).toContain("TITLE_PATH_MISMATCH");
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(false);
    });
  });

  it("includes appended-content-only validation metadata for append dry-runs", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Existing\n");
      const result = await obsidianWrite({ operation: "append", path: "Projects/Plan.md", content: "\n## Update\nSee [broken](../Secrets.md)." }, { vaultRoot });

      expect(result).toMatchObject({ status: "preview", operation: "append", dryRun: true, committed: false, validation: { target: "proposed_content", expectedPath: "Projects/Plan.md", summary: { checkedScope: "write_append_content" } } });
      expect(result.validation?.valid).toBe(true);
      expect(result.validation?.degradedSignals).toContain("validation_scope");
      expect(result.validation?.warnings.join("\n")).toMatch(/appended content/i);
      expect(result.validation?.issues.find((issue) => issue.code === "SUSPICIOUS_TRAVERSAL_PATH")?.severity).toBe("warning");
      await expectNoteUnchanged(vaultRoot, "Projects/Plan.md", "# Existing\n");
    });
  });

  it("does not add validation metadata to commits and warning/info validation does not block commits", async () => {
    await withTempVault(async (vaultRoot) => {
      const create = await obsidianWrite({ operation: "create", path: "Projects/Plan.md", content: "# Different\nSee [broken](../Secrets.md).", dryRun: false }, { vaultRoot });
      expect(create).toMatchObject({ status: "success", committed: true });
      expect(create.validation).toBeUndefined();
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toContain("../Secrets.md");

      const append = await obsidianWrite({ operation: "append", path: "Projects/Plan.md", content: "\n## Empty", dryRun: false }, { vaultRoot });
      expect(append).toMatchObject({ status: "success", committed: true });
      expect(append.validation).toBeUndefined();
    });
  });

  it("does not add validation metadata to create_folder dry-runs", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "create_folder", path: "Projects/New Area" }, { vaultRoot });

      expect(result).toMatchObject({ status: "preview", operation: "create_folder", preview: { targetKind: "folder" } });
      expect(result.validation).toBeUndefined();
    });
  });
});
