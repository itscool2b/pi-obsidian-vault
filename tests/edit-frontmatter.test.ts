import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { readNote, seedNote, withTempVault } from "./write-test-utils.js";

function bodyAfterFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const closing = content.indexOf("\n---\n", 4);
  return closing === -1 ? content : content.slice(closing + "\n---\n".length);
}

describe("obsidian_edit frontmatter operations", () => {
  it("updates an existing top-level property and preserves the note body", async () => {
    await withTempVault(async (vaultRoot) => {
      const body = "# Title\n\nBody text.\n";
      await seedNote(vaultRoot, "Notes/Meta.md", `---\nstatus: draft\ntags: [test]\n---\n${body}`);
      const result = await obsidianEdit({ operation: "update_frontmatter", path: "Notes/Meta.md", property: "status", value: "reviewed", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "success", committed: true, target: { property: { name: "status" } } });
      const content = await readNote(vaultRoot, "Notes/Meta.md");
      expect(content).toContain("status: reviewed\n");
      expect(bodyAfterFrontmatter(content)).toBe(body);
    });
  });

  it("creates frontmatter when missing and preserves the original body", async () => {
    await withTempVault(async (vaultRoot) => {
      const body = "# No Frontmatter\n\nBody text.\n";
      await seedNote(vaultRoot, "Notes/No Meta.md", body);
      const result = await obsidianEdit({ operation: "update_frontmatter", path: "Notes/No Meta.md", property: "status", value: "new", dryRun: false }, { vaultRoot });
      expect(result.status).toBe("success");
      const content = await readNote(vaultRoot, "Notes/No Meta.md");
      expect(content).toBe(`---\nstatus: new\n---\n${body}`);
    });
  });

  it("removes an existing top-level property and preserves the note body", async () => {
    await withTempVault(async (vaultRoot) => {
      const body = "# Title\n\nBody text.\n";
      await seedNote(vaultRoot, "Notes/Remove.md", `---\nstatus: draft\ntags: [test]\n---\n${body}`);
      const result = await obsidianEdit({ operation: "remove_frontmatter", path: "Notes/Remove.md", property: "tags", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "success", target: { property: { name: "tags" } } });
      const content = await readNote(vaultRoot, "Notes/Remove.md");
      expect(content).not.toContain("tags:");
      expect(bodyAfterFrontmatter(content)).toBe(body);
    });
  });

  it("fails deterministically for missing, duplicate, and malformed frontmatter targets", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/MissingProp.md", "---\nstatus: draft\n---\n# Body\n");
      const missing = await obsidianEdit({ operation: "remove_frontmatter", path: "Notes/MissingProp.md", property: "missing", dryRun: false }, { vaultRoot });
      expect(missing).toMatchObject({ status: "not_found", committed: false, error: { code: "PROPERTY_NOT_FOUND" } });

      await seedNote(vaultRoot, "Notes/DuplicateProp.md", "---\nstatus: draft\nstatus: done\n---\n# Body\n");
      const duplicate = await obsidianEdit({ operation: "update_frontmatter", path: "Notes/DuplicateProp.md", property: "status", value: "x", dryRun: false }, { vaultRoot });
      expect(duplicate).toMatchObject({ status: "ambiguous", committed: false, error: { code: "DUPLICATE_PROPERTY", details: { count: 2 } } });

      await seedNote(vaultRoot, "Notes/Broken.md", "---\nstatus: broken\n# Body never starts\n");
      const broken = await obsidianEdit({ operation: "update_frontmatter", path: "Notes/Broken.md", property: "status", value: "fixed", dryRun: false }, { vaultRoot });
      expect(broken).toMatchObject({ status: "validation_error", committed: false, error: { code: "MALFORMED_FRONTMATTER" } });
      expect(await readNote(vaultRoot, "Notes/Broken.md")).toBe("---\nstatus: broken\n# Body never starts\n");
    });
  });

  it("serializes JSON-compatible values deterministically", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Notes/Values.md", "# Body\n");
      const result = await obsidianEdit({ operation: "update_frontmatter", path: "Notes/Values.md", property: "meta", value: { b: 2, a: [true, "x"] }, dryRun: false }, { vaultRoot });
      expect(result.status).toBe("success");
      expect(await readNote(vaultRoot, "Notes/Values.md")).toContain("meta: { a: [true, x], b: 2 }");
    });
  });
});
