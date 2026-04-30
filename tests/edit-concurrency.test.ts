import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { obsidianWrite } from "../src/write-engine.js";
import { readNote, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_edit concurrency", () => {
  it("serializes concurrent committed edits to the same normalized target path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Logs/Race.md", "# Race\n\n## Log\n\nBase\n");
      const edits = await Promise.all([
        obsidianEdit({ operation: "insert_under_heading", path: "Logs/Race.md", heading: "## Log", content: "A\n", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "insert_under_heading", path: "@Logs/Race.md", heading: "## Log", content: "B\n", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "insert_under_heading", path: "Logs/Race.md", heading: "## Log", content: "C\n", dryRun: false }, { vaultRoot }),
      ]);
      expect(edits.every((result) => result.status === "success" && result.committed)).toBe(true);
      const content = await readNote(vaultRoot, "Logs/Race.md");
      expect(content).toContain("Base");
      expect(content.match(/\bA\b/g)).toHaveLength(1);
      expect(content.match(/\bB\b/g)).toHaveLength(1);
      expect(content.match(/\bC\b/g)).toHaveLength(1);
    });
  });

  it("serializes mixed obsidian_write and obsidian_edit commits to the same normalized target path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Mixed/Race.md", "# Mixed\n\n## Log\n\nBase\n");
      const results = await Promise.all([
        obsidianWrite({ operation: "append", path: "Mixed/Race.md", content: "\nWRITE", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "insert_under_heading", path: "@Mixed/Race.md", heading: "## Log", content: "EDIT\n", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      const content = await readNote(vaultRoot, "Mixed/Race.md");
      expect(content).toContain("EDIT");
      expect(content).toContain("WRITE");
      expect(content).toContain("Base");
      expect(content.match(/EDIT/g)).toHaveLength(1);
      expect(content.match(/WRITE/g)).toHaveLength(1);
    });
  });

  it("does not force different safe target paths through a single global queue", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "A/One.md", "# One\n\n## Log\n\nBase\n");
      await seedNote(vaultRoot, "B/Two.md", "# Two\n\n## Log\n\nBase\n");
      const results = await Promise.all([
        obsidianEdit({ operation: "insert_under_heading", path: "A/One.md", heading: "## Log", content: "One\n", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "insert_under_heading", path: "B/Two.md", heading: "## Log", content: "Two\n", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "A/One.md")).toContain("One");
      expect(await readNote(vaultRoot, "B/Two.md")).toContain("Two");
    });
  });

  it("serializes concurrent exact-text edits to the same normalized target path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Exact/Race.md", "# Race\n\nA B C\n");
      const results = await Promise.all([
        obsidianEdit({ operation: "replace_exact_text", path: "Exact/Race.md", oldText: "A", newText: "AA", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "@Exact/Race.md", oldText: "B", newText: "BB", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "Exact/Race.md", oldText: "C", newText: "CC", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "Exact/Race.md")).toBe("# Race\n\nAA BB CC\n");
    });
  });

  it("serializes mixed obsidian_write append and exact-text edit commits to the same normalized target path", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Exact/Mixed.md", "# Mixed\n\nBase\n");
      const results = await Promise.all([
        obsidianWrite({ operation: "append", path: "Exact/Mixed.md", content: "\nWRITE", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "@Exact/Mixed.md", oldText: "Base", newText: "EDIT", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      const content = await readNote(vaultRoot, "Exact/Mixed.md");
      expect(content).toContain("EDIT");
      expect(content).toContain("WRITE");
      expect(content).not.toContain("Base");
    });
  });

  it("does not force exact-text edits for different safe target paths through a single global queue", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Exact/A.md", "# A\n\nAlpha\n");
      await seedNote(vaultRoot, "Exact/B.md", "# B\n\nBeta\n");
      const results = await Promise.all([
        obsidianEdit({ operation: "replace_exact_text", path: "Exact/A.md", oldText: "Alpha", newText: "One", dryRun: false }, { vaultRoot }),
        obsidianEdit({ operation: "replace_exact_text", path: "Exact/B.md", oldText: "Beta", newText: "Two", dryRun: false }, { vaultRoot }),
      ]);
      expect(results.every((result) => result.status === "success" && result.committed)).toBe(true);
      expect(await readNote(vaultRoot, "Exact/A.md")).toContain("One");
      expect(await readNote(vaultRoot, "Exact/B.md")).toContain("Two");
    });
  });
});
