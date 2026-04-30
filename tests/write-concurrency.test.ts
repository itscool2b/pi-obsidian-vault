import { describe, expect, it } from "vitest";
import { obsidianWrite } from "../src/write-engine.js";
import { readNote, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_write concurrency", () => {
  it("serializes concurrent appends to the same normalized target path without lost updates", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Logs/Race.md", "base");
      const writes = await Promise.all([
        obsidianWrite({ operation: "append", path: "Logs/Race.md", content: "\nA", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "append", path: "@Logs/Race.md", content: "\nB", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "append", path: "Logs/Race.md", content: "\nC", dryRun: false }, { vaultRoot }),
      ]);
      expect(writes.every((result) => result.status === "success" && result.committed)).toBe(true);
      const content = await readNote(vaultRoot, "Logs/Race.md");
      expect(content).toContain("base");
      expect(content.match(/\nA/g)).toHaveLength(1);
      expect(content.match(/\nB/g)).toHaveLength(1);
      expect(content.match(/\nC/g)).toHaveLength(1);
    });
  });

  it("serializes concurrent creates to the same target with one success and conflicts for the rest", async () => {
    await withTempVault(async (vaultRoot) => {
      const writes = await Promise.all([
        obsidianWrite({ operation: "create", path: "Race/New.md", content: "one", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "@Race/New.md", content: "two", dryRun: false }, { vaultRoot }),
        obsidianWrite({ operation: "create", path: "Race/New.md", content: "three", dryRun: false }, { vaultRoot }),
      ]);
      expect(writes.filter((result) => result.status === "success")).toHaveLength(1);
      expect(writes.filter((result) => result.status === "conflict")).toHaveLength(2);
      expect(["one", "two", "three"]).toContain(await readNote(vaultRoot, "Race/New.md"));
    });
  });
});
