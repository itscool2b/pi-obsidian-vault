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

  it("does not force independent write, edit, move, and trash targets through a global queue", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Edit/Note.md", "# Edit\n\nold\n");
      await seedNote(vaultRoot, "Move/Note.md", "move");
      await seedNote(vaultRoot, "Trash/Note.md", "trash");
      await seedFolder(vaultRoot, "Archive");
      const results = await Promise.all([
        obsidianWrite({ operation: "create", path: "Write/New.md", content: "write", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "Edit/Note.md", oldText: "old", newText: "new", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "move_note", fromPath: "Move/Note.md", toPath: "Archive/Note.md", dryRun: false }, { vaultRoot }),
        obsidianManage({ operation: "trash_note", path: "Trash/Note.md", trashFolder: "TrashBin", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "Write/New.md")).toBe("write");
      expect(await readNote(vaultRoot, "Edit/Note.md")).toContain("new");
      expect(await readNote(vaultRoot, "Archive/Note.md")).toBe("move");
      expect(await readNote(vaultRoot, "TrashBin/Note.md")).toBe("trash");
    });
  });
});
