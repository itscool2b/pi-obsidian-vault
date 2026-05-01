import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { pathExists, readNote, seedFile, seedFolder, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

describe("obsidian_manage filesystem behavior", () => {
  it("commits a move to another existing folder and preserves note content", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\nBody\n");
      await seedFolder(vaultRoot, "Archive");

      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({
        status: "success",
        operation: "move_note",
        fromPath: "Projects/Plan.md",
        toPath: "Archive/Plan.md",
        dryRun: false,
        committed: true,
        target: { sourceExistsBefore: true, sourceExistsAfter: false, destinationExistsBefore: false, destinationExistsAfter: true, movedToDifferentFolder: true },
      });
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(false);
      expect(await readNote(vaultRoot, "Archive/Plan.md")).toBe("# Plan\nBody\n");
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("commits a same-folder rename without modifying other vault content", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Plan\n");
      await seedNote(vaultRoot, "Projects/Other.md", "# Other\n");

      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Projects/Roadmap.md", dryRun: false }, { vaultRoot });

      expect(result).toMatchObject({ status: "success", target: { renamedWithinFolder: true, movedToDifferentFolder: false } });
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(false);
      expect(await readNote(vaultRoot, "Projects/Roadmap.md")).toBe("# Plan\n");
      expect(await readNote(vaultRoot, "Projects/Other.md")).toBe("# Other\n");
    });
  });

  it("moves to another existing nested folder without creating parents", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "nested");
      await seedFolder(vaultRoot, "Archive/2026");

      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/2026/Plan.md", dryRun: false }, { vaultRoot });

      expect(result.status).toBe("success");
      expect(await readNote(vaultRoot, "Archive/2026/Plan.md")).toBe("nested");
      expect(await pathExists(vaultRoot, "Archive/2026/Plan.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Archive/MissingParent")).toBe(false);
    });
  });

  it("returns not_found for missing source without creating destination", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFolder(vaultRoot, "Archive");
      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Missing.md", toPath: "Archive/Missing.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "not_found", committed: false, error: { code: "SOURCE_NOT_FOUND", category: "not_found" } });
      expect(await pathExists(vaultRoot, "Archive/Missing.md")).toBe(false);
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("returns conflict for an existing destination without overwriting or moving source", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      await seedNote(vaultRoot, "Archive/Plan.md", "destination");
      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "TARGET_EXISTS", category: "conflict" } });
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe("source");
      expect(await readNote(vaultRoot, "Archive/Plan.md")).toBe("destination");
    });
  });

  it("returns not_found/PARENT_MISSING for missing destination parent without creating folders", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Missing/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "not_found", committed: false, error: { code: "PARENT_MISSING", category: "not_found" } });
      expect(await pathExists(vaultRoot, "Missing")).toBe(false);
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe("source");
      expect(stringifyDetails(result)).not.toContain(vaultRoot);
    });
  });

  it("returns conflict when destination parent is a file", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      await seedFile(vaultRoot, "Archive/FileParent.md", "parent file");
      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Archive/FileParent.md/Plan.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "PARENT_NOT_FOLDER", category: "conflict" } });
      expect(await readNote(vaultRoot, "Projects/Plan.md")).toBe("source");
      expect(await readNote(vaultRoot, "Archive/FileParent.md")).toBe("parent file");
    });
  });

  it("returns conflict when source path is a folder and does not move it", async () => {
    await withTempVault(async (vaultRoot) => {
      await mkdir(path.join(vaultRoot, "Projects", "Folder.md"), { recursive: true });
      await seedFolder(vaultRoot, "Archive");
      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Folder.md", toPath: "Archive/Folder.md", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "conflict", committed: false, error: { code: "SOURCE_NOT_NOTE", category: "conflict" } });
      expect(await pathExists(vaultRoot, "Projects/Folder.md")).toBe(true);
      expect(await pathExists(vaultRoot, "Archive/Folder.md")).toBe(false);
    });
  });
});
