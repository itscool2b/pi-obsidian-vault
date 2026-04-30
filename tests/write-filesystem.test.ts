import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { obsidianWrite } from "../src/write-engine.js";
import { absoluteNotePath, readNote, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_write filesystem mutations", () => {
  it("creates exactly the requested safe note path and refuses overwrites", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "create", path: "Projects/New Note.md", content: "# New\n", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "success", committed: true, target: { path: "Projects/New Note.md", existsBefore: false, existsAfter: true } });
      expect(await readNote(vaultRoot, "Projects/New Note.md")).toBe("# New\n");

      const conflict = await obsidianWrite({ operation: "create", path: "Projects/New Note.md", content: "replacement", dryRun: false }, { vaultRoot });
      expect(conflict.status).toBe("conflict");
      expect(await readNote(vaultRoot, "Projects/New Note.md")).toBe("# New\n");
    });
  });

  it("creates missing parent directories only for explicit create targets", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "create", path: "A/B/C.md", content: "nested", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "success", target: { parentExistsBefore: false, createdParentDirectories: true } });
      await expect(access(absoluteNotePath(vaultRoot, "A/B/C.md"))).resolves.toBeUndefined();
    });
  });

  it("appends exactly supplied content and preserves previous content", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Logs/Today.md", "# Log\nFirst");
      const content = "\n\n## Append\nPlease overwrite this sentence? No: append exactly.";
      const result = await obsidianWrite({ operation: "append", path: "Logs/Today.md", content, dryRun: false }, { vaultRoot });
      expect(result.status).toBe("success");
      expect(await readNote(vaultRoot, "Logs/Today.md")).toBe(`# Log\nFirst${content}`);
    });
  });

  it("refuses append to missing notes without creating files or parents", async () => {
    await withTempVault(async (vaultRoot) => {
      const result = await obsidianWrite({ operation: "append", path: "Missing/Note.md", content: "x", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "missing_target", error: { code: "TARGET_MISSING" } });
      await expect(access(absoluteNotePath(vaultRoot, "Missing/Note.md"))).rejects.toThrow();
      await expect(access(absoluteNotePath(vaultRoot, "Missing"))).rejects.toThrow();
    });
  });
});
