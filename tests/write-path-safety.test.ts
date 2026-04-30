import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { obsidianWrite } from "../src/write-engine.js";
import { stringifyDetails, withTempVault } from "./write-test-utils.js";

const unsafePaths = [
  "/tmp/outside.md",
  "C:\\Users\\me\\outside.md",
  "../outside.md",
  "Folder/%2e%2e/outside.md",
  "Folder/%25252e%25252e/outside.md",
  ".obsidian/plugins/x.md",
  "Notes/file.txt",
  ".hidden/Note.md",
  "Notes/./Bad.md",
];

describe("obsidian_write path safety", () => {
  it("rejects unsafe paths without leaking vaultRoot or absolute target paths", async () => {
    await withTempVault(async (vaultRoot) => {
      for (const targetPath of unsafePaths) {
        const result = await obsidianWrite({ operation: "create", path: targetPath, content: "x", dryRun: false }, { vaultRoot });
        expect(["safety_refusal", "validation_error"]).toContain(result.status);
        expect(result.committed).toBe(false);
        const text = stringifyDetails(result);
        expect(text).not.toContain(vaultRoot);
        expect(text).not.toContain(path.join(vaultRoot, "Notes"));
      }
    });
  });

  it("rejects symlink containment escapes", async () => {
    await withTempVault(async (vaultRoot) => {
      const outside = await mkdtemp(path.join(os.tmpdir(), "pi-obsidian-outside-"));
      try {
        await symlink(outside, path.join(vaultRoot, "Linked"), "dir");
        const result = await obsidianWrite({ operation: "create", path: "Linked/Escape.md", content: "x", dryRun: false }, { vaultRoot });
        expect(result).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "UNSAFE_PATH" } });
        const text = stringifyDetails(result);
        expect(text).not.toContain(vaultRoot);
        expect(text).not.toContain(outside);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });
});
