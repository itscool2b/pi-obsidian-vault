import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { pathExists, readNote, seedFolder, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage copy_note concurrency", () => {
  it("serializes concurrent copy operations with the same destination", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "A/Plan.md", "A");
      await seedNote(vaultRoot, "B/Plan.md", "B");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "copy_note", fromPath: "A/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "copy_note", fromPath: "B/Plan.md", toPath: "@Archive/Plan.md", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict" && result.error?.code === "TARGET_EXISTS")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "Archive/Plan.md")).toBe(true);
      expect(await readNote(vaultRoot, "A/Plan.md")).toBe("A");
      expect(await readNote(vaultRoot, "B/Plan.md")).toBe("B");
    });
  });

  it("serializes copy operations with the same source and preserves source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Source/Plan.md", "source");
      await seedFolder(vaultRoot, "A");
      await seedFolder(vaultRoot, "B");
      const results = await Promise.all([
        obsidianManage({ operation: "copy_note", fromPath: "Source/Plan.md", toPath: "A/Plan.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "copy_note", fromPath: "@Source/Plan.md", toPath: "B/Plan.md", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "Source/Plan.md")).toBe("source");
      expect(await readNote(vaultRoot, "A/Plan.md")).toBe("source");
      expect(await readNote(vaultRoot, "B/Plan.md")).toBe("source");
    });
  });

  it("serializes mixed copy and write commits targeting the same destination", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Source/B.md", "B");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "copy_note", fromPath: "Source/B.md", toPath: "Archive/B.md", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "@Archive/B.md", content: "# Competing destination", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "Archive/B.md")).toBe(true);
      expect(await readNote(vaultRoot, "Source/B.md")).toBe("B");
    });
  });

  it("serializes mixed copy and edit commits involving the same source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Source/A.md", "# A\n\nbefore\n");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "copy_note", fromPath: "Source/A.md", toPath: "Archive/A.md", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "@Source/A.md", oldText: "before", newText: "after", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await pathExists(vaultRoot, "Source/A.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Archive/A.md")).toBe(true);
      const source = await readNote(vaultRoot, "Source/A.md");
      const copy = await readNote(vaultRoot, "Archive/A.md");
      expect(["# A\n\nbefore\n", "# A\n\nafter\n"]).toContain(source);
      expect(["# A\n\nbefore\n", "# A\n\nafter\n"]).toContain(copy);
    });
  });

  it("does not force independent copy, restore, write, edit, move, and trash targets through a global queue", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Copy/Note.md", "copy");
      await seedNote(vaultRoot, "_Trash/Restore.md", "restore");
      await seedNote(vaultRoot, "Move/Note.md", "move");
      await seedNote(vaultRoot, "Trash/Note.md", "trash");
      await seedNote(vaultRoot, "Edit/Note.md", "# Edit\n\nold\n");
      await seedFolder(vaultRoot, "Archive");
      await seedFolder(vaultRoot, "Restore");
      const results = await Promise.all([
        obsidianManage({ operation: "copy_note", fromPath: "Copy/Note.md", toPath: "Archive/Copied.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/Restore.md", toPath: "Restore/Restore.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "move_note", fromPath: "Move/Note.md", toPath: "Archive/Move.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "trash_note", path: "Trash/Note.md", trashFolder: "TrashOut", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "Write/New.md", content: "write", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "Edit/Note.md", oldText: "old", newText: "new", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "Archive/Copied.md")).toBe("copy");
      expect(await readNote(vaultRoot, "Copy/Note.md")).toBe("copy");
      expect(await readNote(vaultRoot, "Restore/Restore.md")).toBe("restore");
      expect(await readNote(vaultRoot, "Archive/Move.md")).toBe("move");
      expect(await readNote(vaultRoot, "TrashOut/Note.md")).toBe("trash");
      expect(await readNote(vaultRoot, "Write/New.md")).toBe("write");
      expect(await readNote(vaultRoot, "Edit/Note.md")).toContain("new");
    });
  });
});
