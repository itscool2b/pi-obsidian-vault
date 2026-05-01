import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { pathExists, readNote, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage restore_note concurrency", () => {
  it("serializes concurrent restore operations with the same normalized trashPath", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/A.md", "A");
      await seedFolder(vaultRoot, "RestoreA");
      await seedFolder(vaultRoot, "RestoreB");
      const results = await Promise.all([
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/A.md", toPath: "RestoreA/A.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "restore_note", trashPath: "@_Trash/A.md", toPath: "RestoreB/A.md", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "not_found" && result.error?.code === "TRASH_SOURCE_NOT_FOUND")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "_Trash/A.md")).toBe(false);
    });
  });

  it("serializes concurrent restore operations with the same destination", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/A.md", "A");
      await seedNote(vaultRoot, "_Trash/B.md", "B");
      await seedFolder(vaultRoot, "Restore");
      const results = await Promise.all([
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/A.md", toPath: "Restore/Note.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/B.md", toPath: "@Restore/Note.md", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict" && result.error?.code === "TARGET_EXISTS")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "Restore/Note.md")).toBe(true);
    });
  });

  it("serializes mixed restore and write commits targeting the same destination", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/B.md", "B");
      await seedFolder(vaultRoot, "Restore");
      const results = await Promise.all([
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/B.md", toPath: "Restore/B.md", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "@Restore/B.md", content: "# Competing destination", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "Restore/B.md")).toBe(true);
    });
  });

  it("serializes mixed restore and edit commits involving the same trash source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/A.md", "# A\n\nbefore\n");
      await seedFolder(vaultRoot, "Restore");
      const results = await Promise.all([
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/A.md", toPath: "Restore/A.md", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "@_Trash/A.md", oldText: "before", newText: "after", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.some((result) => result.status === "success")).toBe(true);
      expect(results.every((result) => result.committed || result.status === "not_found")).toBe(true);
      expect(await pathExists(vaultRoot, "_Trash/A.md")).toBe(false);
      expect(await pathExists(vaultRoot, "Restore/A.md")).toBe(true);
      const content = await readNote(vaultRoot, "Restore/A.md");
      expect(content === "# A\n\nbefore\n" || content === "# A\n\nafter\n").toBe(true);
    });
  });

  it("revalidates trashPath containment inside committed locks", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/C.md", "C");
      await seedFolder(vaultRoot, "Restore");
      const result = await obsidianManage({ operation: "restore_note", trashPath: "_Trash/C.md", toPath: "Restore/C.md", trashFolder: "OtherTrash", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "TRASH_PATH_OUTSIDE_TRASH" } });
      expect(await readNote(vaultRoot, "_Trash/C.md")).toBe("C");
      expect(await pathExists(vaultRoot, "Restore/C.md")).toBe(false);
    });
  });

  it("does not force independent restore, write, edit, move, and trash targets through a global queue", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/A.md", "A");
      await seedNote(vaultRoot, "_Trash/B.md", "B");
      await seedNote(vaultRoot, "Move/C.md", "C");
      await seedNote(vaultRoot, "Trash/D.md", "D");
      await seedNote(vaultRoot, "Edit/Note.md", "# E\n\nold\n");
      await seedFolder(vaultRoot, "RestoreA");
      await seedFolder(vaultRoot, "RestoreB");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/A.md", toPath: "RestoreA/A.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/B.md", toPath: "RestoreB/B.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "move_note", fromPath: "Move/C.md", toPath: "Archive/C.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "trash_note", path: "Trash/D.md", trashFolder: "TrashOut", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "Write/New.md", content: "# New", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "Edit/Note.md", oldText: "old", newText: "new", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "RestoreA/A.md")).toBe("A");
      expect(await readNote(vaultRoot, "RestoreB/B.md")).toBe("B");
      expect(await readNote(vaultRoot, "Archive/C.md")).toBe("C");
      expect(await readNote(vaultRoot, "TrashOut/D.md")).toBe("D");
      expect(await readNote(vaultRoot, "Write/New.md")).toBe("# New");
      expect(await readNote(vaultRoot, "Edit/Note.md")).toContain("new");
    });
  });
});
