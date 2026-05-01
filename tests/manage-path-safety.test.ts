import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { obsidianManage } from "../src/manage-engine.js";
import { pathExists, seedFolder, seedNote, stringifyDetails, withTempVault } from "./write-test-utils.js";

const unsafeSourcePaths = [
  "/tmp/outside.md",
  "C:\\Users\\me\\outside.md",
  "\\\\server\\share\\outside.md",
  "../outside.md",
  "Folder/%2e%2e/outside.md",
  "Folder/%25252e%25252e/outside.md",
  ".obsidian/plugins/x.md",
  ".hidden/Note.md",
  "Notes/file.txt",
  "Notes/file",
  "Notes/./Bad.md",
  "",
  "   ",
  ".",
  "@",
];

const unsafeDestinationPaths = [
  "/tmp/outside.md",
  "C:\\Users\\me\\outside.md",
  "\\\\server\\share\\outside.md",
  "../outside.md",
  "Folder/%2e%2e/outside.md",
  "Folder/%25252e%25252e/outside.md",
  ".obsidian/plugins/x.md",
  ".hidden/Note.md",
  "Notes/file.txt",
  "Notes/file",
  "Notes/./Bad.md",
  "",
  "   ",
  ".",
  "@",
];

describe("obsidian_manage path safety", () => {
  it("rejects unsafe source paths without leaking raw absolute paths", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedFolder(vaultRoot, "Archive");
      for (const fromPath of unsafeSourcePaths) {
        const result = await obsidianManage({ operation: "move_note", fromPath, toPath: "Archive/Plan.md", dryRun: false }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
        expect(result.committed).toBe(false);
        if (result.status === "safety_refusal") expect(result.error?.code).toBe("UNSAFE_FROM_PATH");
        const text = stringifyDetails(result);
        expect(text).not.toContain(vaultRoot);
        expect(text).not.toContain("/tmp/outside.md");
        expect(text).not.toContain("C:\\Users\\me\\outside.md");
      }
    });
  });

  it("rejects unsafe destination paths without leaking raw absolute paths", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      for (const toPath of unsafeDestinationPaths) {
        const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath, dryRun: false }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
        expect(result.committed).toBe(false);
        if (result.status === "safety_refusal") expect(result.error?.code).toBe("UNSAFE_TO_PATH");
        const text = stringifyDetails(result);
        expect(text).not.toContain(vaultRoot);
        expect(text).not.toContain("/tmp/outside.md");
        expect(text).not.toContain("C:\\Users\\me\\outside.md");
      }
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(true);
    });
  });

  it("rejects same normalized source and destination paths", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "source");
      const result = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "@Projects/Plan.md" }, { vaultRoot });
      expect(result).toMatchObject({ status: "validation_error", committed: false, error: { code: "SAME_PATH", category: "validation" } });
      expect(await pathExists(vaultRoot, "Projects/Plan.md")).toBe(true);
    });
  });

  it("rejects symlink containment escapes for source and destination parent", async () => {
    await withTempVault(async (vaultRoot) => {
      const outside = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-outside-"));
      try {
        await seedNote(vaultRoot, "Projects/Plan.md", "source");
        await symlink(outside, path.join(vaultRoot, "Linked"), "dir");
        const source = await obsidianManage({ operation: "move_note", fromPath: "Linked/Escape.md", toPath: "Projects/Escape.md", dryRun: false }, { vaultRoot });
        expect(["safety_refusal", "not_found"]).toContain(source.status);

        const destination = await obsidianManage({ operation: "move_note", fromPath: "Projects/Plan.md", toPath: "Linked/Plan.md", dryRun: false }, { vaultRoot });
        expect(destination).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
        const text = stringifyDetails([source, destination]);
        expect(text).not.toContain(vaultRoot);
        expect(text).not.toContain(outside);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });
});
