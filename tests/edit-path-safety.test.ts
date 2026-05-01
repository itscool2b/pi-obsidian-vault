import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { expectNoLocalPathLeak, seedNote, withTempVault } from "./write-test-utils.js";

const unsafePaths = [
  "/tmp/outside.md",
  "C:\\Users\\me\\outside.md",
  "\\\\server\\share\\outside.md",
  "../outside.md",
  "Folder/%2e%2e/outside.md",
  "Folder/%25252e%25252e/outside.md",
  ".obsidian/plugins/x.md",
  "Notes/file.txt",
  ".hidden/Note.md",
  "Notes/./Bad.md",
  "",
  "   ",
  ".",
  "@",
];

describe("obsidian_edit path safety", () => {
  it("rejects unsafe paths without leaking vaultRoot or absolute target paths", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const targetPath of unsafePaths) {
        const result = await obsidianEdit({ operation: "update_frontmatter", path: targetPath, property: "status", value: "x", dryRun: false }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
        expect(result.committed).toBe(false);
        expectNoLocalPathLeak(result, vaultRoot);

        const exact = await obsidianEdit({ operation: "replace_exact_text", path: targetPath, oldText: "Old", newText: "New", dryRun: false }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(exact.status);
        expect(exact.committed).toBe(false);
        expectNoLocalPathLeak(exact, vaultRoot);
      }
    });
  });

  it("rejects symlink containment escapes", async () => {
    await withTempVault(async (vaultRoot) => {
      const outside = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-outside-"));
      try {
        await writeFile(path.join(outside, "Escape.md"), "# Outside\n", "utf8");
        await symlink(outside, path.join(vaultRoot, "Linked"), "dir");
        const result = await obsidianEdit({ operation: "update_frontmatter", path: "Linked/Escape.md", property: "status", value: "x", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "UNSAFE_PATH" } });
        expectNoLocalPathLeak(result, vaultRoot);

        const exact = await obsidianEdit({ operation: "replace_exact_text", path: "Linked/Escape.md", oldText: "Outside", newText: "Inside", dryRun: false }, { vaultRoot });
        expect(exact).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "UNSAFE_PATH" } });
        expectNoLocalPathLeak(exact, vaultRoot);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("rejects forbidden edit operation names before mutating existing notes", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Target.md", "# Target\n");
      for (const operation of ["overwrite", "delete", "rename", "move", "open", "shell", "network", "scan", "command", "create", "append", "regex_replace", "fuzzy_replace", "semantic_replace"]) {
        const result = await obsidianEdit({ operation, path: "Notes/Target.md", content: "replacement", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { category: "safety" } });
      }
    });
  });
});
