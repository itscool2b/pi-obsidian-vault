import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { pathExists, readNote, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage trash_note concurrency", () => {
  it("serializes concurrent trash operations with the same normalized source path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/A.md", "A");
      const results = await Promise.all([
        obsidianManage({ operation: "trash_note", path: "Race/A.md", trashFolder: "TrashA", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "trash_note", path: "@Race/A.md", trashFolder: "TrashB", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "not_found" && result.error?.code === "SOURCE_NOT_FOUND")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "Race/A.md")).toBe(false);
    });
  });

  it("serializes concurrent trash operations with the same computed final trash path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/A.md", "A");
      await seedNote(vaultRoot, "Other/A.md", "Other A");
      const results = await Promise.all([
        obsidianManage({ operation: "trash_note", path: "Race/A.md", trashFolder: "_Trash", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "trash_note", path: "Other/A.md", trashFolder: "@_Trash", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict" && result.error?.code === "TRASH_TARGET_EXISTS")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "_Trash/A.md")).toBe(true);
    });
  });

  it("serializes mixed trash and write commits that target the same final trash path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/B.md", "B");
      const results = await Promise.all([
        obsidianManage({ operation: "trash_note", path: "Race/B.md", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "@_Trash/B.md", content: "# Competing destination", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "_Trash/B.md")).toBe(true);
    });
  });

  it("serializes mixed trash and edit commits involving the same source path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/A.md", "# A\n\nbefore\n");
      const results = await Promise.all([
        obsidianManage({ operation: "trash_note", path: "Race/A.md", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "@Race/A.md", oldText: "before", newText: "after", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.some((result) => result.status === "success")).toBe(true);
      expect(results.every((result) => result.committed || result.status === "not_found")).toBe(true);
      expect(await pathExists(vaultRoot, "_Trash/A.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Race/A.md")).toBe(false);
      const content = await readNote(vaultRoot, "_Trash/A.md");
      expect(content === "# A\n\nbefore\n" || content === "# A\n\nafter\n").toBe(true);
    });
  });

  it("serializes mixed trash and move commits targeting the same final trash path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/C.md", "C");
      await seedNote(vaultRoot, "Other/C.md", "Other C");
      await seedFolder(vaultRoot, "_Trash");
      const results = await Promise.all([
        obsidianManage({ operation: "trash_note", path: "Race/C.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "move_note", fromPath: "Other/C.md", toPath: "_Trash/C.md", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "_Trash/C.md")).toBe(true);
    });
  });

  it("does not force independent trash, write, edit, and move targets through a global queue", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Trash/A.md", "A");
      await seedNote(vaultRoot, "Trash/B.md", "B");
      await seedNote(vaultRoot, "Move/C.md", "C");
      await seedNote(vaultRoot, "Edit/Note.md", "# E\n\nold\n");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "trash_note", path: "Trash/A.md", trashFolder: "TrashA", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "trash_note", path: "Trash/B.md", trashFolder: "TrashB", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "move_note", fromPath: "Move/C.md", toPath: "Archive/C.md", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "Write/New.md", content: "# New", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "Edit/Note.md", oldText: "old", newText: "new", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "TrashA/A.md")).toBe("A");
      expect(await readNote(vaultRoot, "TrashB/B.md")).toBe("B");
      expect(await readNote(vaultRoot, "Archive/C.md")).toBe("C");
      expect(await readNote(vaultRoot, "Write/New.md")).toBe("# New");
      expect(await readNote(vaultRoot, "Edit/Note.md")).toContain("new");
    });
  });
});
