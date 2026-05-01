import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { pathExists, readNote, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage concurrency", () => {
  it("serializes concurrent moves with the same normalized source path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/A.md", "A");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "move_note", fromPath: "Race/A.md", toPath: "Archive/A.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "move_note", fromPath: "@Race/A.md", toPath: "Archive/C.md", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "not_found" && result.error?.code === "SOURCE_NOT_FOUND")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "Race/A.md")).toBe(false);
    });
  });

  it("serializes concurrent moves with the same normalized destination path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/A.md", "A");
      await seedNote(vaultRoot, "Race/B.md", "B");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "move_note", fromPath: "Race/A.md", toPath: "Archive/Target.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "move_note", fromPath: "Race/B.md", toPath: "@Archive/Target.md", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict" && result.error?.code === "TARGET_EXISTS")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "Archive/Target.md")).toBe(true);
    });
  });

  it("serializes mixed manage and write commits that target the same destination path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/B.md", "B");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "move_note", fromPath: "Race/B.md", toPath: "Archive/B.md", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "@Archive/B.md", content: "# Competing destination", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "Archive/B.md")).toBe(true);
    });
  });

  it("serializes mixed manage and edit commits involving the same source path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/A.md", "# A\n\nbefore\n");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "move_note", fromPath: "Race/A.md", toPath: "Archive/A.md", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "@Race/A.md", oldText: "before", newText: "after", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.some((result) => result.status === "success")).toBe(true);
      expect(results.every((result) => result.committed || result.status === "not_found")).toBe(true);
      expect(await pathExists(vaultRoot, "Archive/A.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Race/A.md")).toBe(false);
      const content = await readNote(vaultRoot, "Archive/A.md");
      expect(content === "# A\n\nbefore\n" || content === "# A\n\nafter\n").toBe(true);
    });
  });

  it("does not force independent manage, write, and edit targets through a global queue", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/A.md", "A");
      await seedNote(vaultRoot, "Edit/Note.md", "# E\n\nold\n");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "move_note", fromPath: "Race/A.md", toPath: "Archive/A.md", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "Write/New.md", content: "# New", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "Edit/Note.md", oldText: "old", newText: "new", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "Archive/A.md")).toBe("A");
      expect(await readNote(vaultRoot, "Write/New.md")).toBe("# New");
      expect(await readNote(vaultRoot, "Edit/Note.md")).toContain("new");
    });
  });
});
