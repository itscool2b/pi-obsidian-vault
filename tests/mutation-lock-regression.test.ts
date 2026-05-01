import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianManage } from "../src/manage-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { pathExists, readNote, seedFolder, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

describe("shared mutation lock regression", () => {
  it("serializes same-target write and manage operations deterministically", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/Source.md", "source");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "move_note", fromPath: "Race/Source.md", toPath: "Archive/Target.md", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "@Archive/Target.md", content: "created", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "Archive/Target.md")).toBe(true);
      expect(stringifyDetails(results)).not.toContain(`${vaultRoot}::`);
    });
  });

  it("serializes overlapping source edits and note management operations", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Race/Source.md", "# Source\n\nbefore\n");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "move_note", fromPath: "Race/Source.md", toPath: "Archive/Source.md", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "@Race/Source.md", oldText: "before", newText: "after", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.some((result) => result.status === "success")).toBe(true);
      expect(results.every((result) => result.committed || result.status === "not_found")).toBe(true);
      expect(await pathExists(vaultRoot, "Race/Source.md")).toBe(false);
      expect(await pathExists(vaultRoot, "Archive/Source.md")).toBe(true);
      const content = await readNote(vaultRoot, "Archive/Source.md");
      expect(["# Source\n\nbefore\n", "# Source\n\nafter\n"]).toContain(content);
    });
  });

  it("serializes trash target collisions without overwriting or auto-renaming", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "A/Plan.md", "A");
      await seedNote(vaultRoot, "B/Plan.md", "B");
      const results = await Promise.all([
        obsidianManage({ operation: "trash_note", path: "A/Plan.md", trashFolder: "_Trash", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "trash_note", path: "B/Plan.md", trashFolder: "@_Trash", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.filter((result) => result.status === "success")).toHaveLength(1);
      expect(results.filter((result) => result.status === "conflict" && result.error?.code === "TRASH_TARGET_EXISTS")).toHaveLength(1);
      expect(await pathExists(vaultRoot, "_Trash/Plan.md")).toBe(true);
      expect(await pathExists(vaultRoot, "_Trash/Plan (1).md")).toBe(false);
    });
  });

  it("serializes restore destination collisions with write, move, and trash operations", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Restore.md", "restore");
      await seedNote(vaultRoot, "Move/Restore.md", "move");
      await seedNote(vaultRoot, "Trash/Restore.md", "trash");
      await seedFolder(vaultRoot, "Archive");
      const writeRace = await Promise.all([
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/Restore.md", toPath: "Archive/Restore.md", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "@Archive/Restore.md", content: "write", dryRun: false }, { vaultRoot }),
      ]);
      expect(writeRace.filter((result) => result.status === "success")).toHaveLength(1);
      expect(writeRace.filter((result) => result.status === "conflict")).toHaveLength(1);

      const moveTrashRace = await Promise.all([
        obsidianManage({ operation: "move_note", fromPath: "Move/Restore.md", toPath: "Archive/Move.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "trash_note", path: "Trash/Restore.md", trashFolder: "Archive", dryRun: false }, { vaultRoot }),
      ]);
      expect(moveTrashRace.filter((result) => result.status === "success")).toHaveLength(1);
      expect(moveTrashRace.filter((result) => result.status === "conflict")).toHaveLength(1);
      expect(stringifyDetails([...writeRace, ...moveTrashRace])).not.toContain(`${vaultRoot}::`);
    });
  });

  it("serializes restore source edits", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "_Trash/Edit.md", "# Edit\n\nold\n");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/Edit.md", toPath: "Archive/Edit.md", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "@_Trash/Edit.md", oldText: "old", newText: "new", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.some((result) => result.status === "success")).toBe(true);
      expect(results.every((result) => result.committed || result.status === "not_found")).toBe(true);
      expect(await pathExists(vaultRoot, "_Trash/Edit.md")).toBe(false);
      expect(await pathExists(vaultRoot, "Archive/Edit.md")).toBe(true);
      expect(["# Edit\n\nold\n", "# Edit\n\nnew\n"]).toContain(await readNote(vaultRoot, "Archive/Edit.md"));
    });
  });

  it("serializes copy destination collisions with write and same-destination copy operations", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Copy/A.md", "A");
      await seedNote(vaultRoot, "Copy/B.md", "B");
      await seedFolder(vaultRoot, "Archive");
      const copyRace = await Promise.all([
        obsidianManage({ operation: "copy_note", fromPath: "Copy/A.md", toPath: "Archive/Copy.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "copy_note", fromPath: "Copy/B.md", toPath: "@Archive/Copy.md", dryRun: false }, { vaultRoot }),
      ]);
      expect(copyRace.filter((result) => result.status === "success")).toHaveLength(1);
      expect(copyRace.filter((result) => result.status === "conflict" && result.error?.code === "TARGET_EXISTS")).toHaveLength(1);

      const writeRace = await Promise.all([
        obsidianManage({ operation: "copy_note", fromPath: "Copy/A.md", toPath: "Archive/WriteRace.md", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "@Archive/WriteRace.md", content: "write", dryRun: false }, { vaultRoot }),
      ]);
      expect(writeRace.filter((result) => result.status === "success")).toHaveLength(1);
      expect(writeRace.filter((result) => result.status === "conflict")).toHaveLength(1);
      expect(stringifyDetails([...copyRace, ...writeRace])).not.toContain(`${vaultRoot}::`);
    });
  });

  it("serializes copy source edits while preserving a deterministic copied snapshot", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Copy/Edit.md", "# Edit\n\nold\n");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianManage({ operation: "copy_note", fromPath: "Copy/Edit.md", toPath: "Archive/Edit.md", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "@Copy/Edit.md", oldText: "old", newText: "new", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(["# Edit\n\nold\n", "# Edit\n\nnew\n"]).toContain(await readNote(vaultRoot, "Copy/Edit.md"));
      expect(["# Edit\n\nold\n", "# Edit\n\nnew\n"]).toContain(await readNote(vaultRoot, "Archive/Edit.md"));
    });
  });

  it("does not force independent write, edit, move, trash, and restore targets through a global queue", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Edit/Note.md", "# Edit\n\nold\n");
      await seedNote(vaultRoot, "Move/Note.md", "move");
      await seedNote(vaultRoot, "Trash/Note.md", "trash");
      await seedNote(vaultRoot, "_Trash/Restore.md", "restore");
      await seedNote(vaultRoot, "Copy/Note.md", "copy");
      await seedFolder(vaultRoot, "Archive");
      await seedFolder(vaultRoot, "Restore");
      const results = await Promise.all([
        obsidianWrite({ operation: "create", path: "Write/New.md", content: "write", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "Edit/Note.md", oldText: "old", newText: "new", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "move_note", fromPath: "Move/Note.md", toPath: "Archive/Note.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "trash_note", path: "Trash/Note.md", trashFolder: "TrashBin", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "restore_note", trashPath: "_Trash/Restore.md", toPath: "Restore/Restore.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "copy_note", fromPath: "Copy/Note.md", toPath: "Archive/Copied.md", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "Write/New.md")).toBe("write");
      expect(await readNote(vaultRoot, "Edit/Note.md")).toContain("new");
      expect(await readNote(vaultRoot, "Archive/Note.md")).toBe("move");
      expect(await readNote(vaultRoot, "TrashBin/Note.md")).toBe("trash");
      expect(await readNote(vaultRoot, "Restore/Restore.md")).toBe("restore");
      expect(await readNote(vaultRoot, "Archive/Copied.md")).toBe("copy");
      expect(await readNote(vaultRoot, "Copy/Note.md")).toBe("copy");
    });
  });
});
