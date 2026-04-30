import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { readNote, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_edit section operations", () => {
  it("commits replace_section only for the matched section body through the next same-or-higher heading", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Sections.md", `# Title

Intro.

## Plan

Old plan.

### Details

Nested detail.

## Log

Existing log.
`);
      const result = await obsidianEdit({ operation: "replace_section", path: "Projects/Sections.md", heading: "## Plan", content: "New plan.\n\n### Details\n\nReplacement detail.", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "success", committed: true, target: { heading: { level: 2, text: "Plan" } } });
      expect(await readNote(vaultRoot, "Projects/Sections.md")).toBe(`# Title

Intro.

## Plan
New plan.

### Details

Replacement detail.
## Log

Existing log.
`);
    });
  });

  it("commits insert_under_heading immediately below the matched heading preserving existing content", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Insert.md", "# Title\n\n## Log\n\nExisting log.\n");
      const result = await obsidianEdit({ operation: "insert_under_heading", path: "Projects/Insert.md", heading: "## Log", content: "- New entry.", dryRun: false }, { vaultRoot });
      expect(result.status).toBe("success");
      expect(await readNote(vaultRoot, "Projects/Insert.md")).toBe("# Title\n\n## Log\n- New entry.\n\nExisting log.\n");
    });
  });

  it("handles empty and final section replacement", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Final.md", "# Title\n\n## Empty\n## Final\nOld");
      const empty = await obsidianEdit({ operation: "replace_section", path: "Projects/Final.md", heading: "## Empty", content: "", dryRun: false }, { vaultRoot });
      expect(empty.status).toBe("success");
      expect(await readNote(vaultRoot, "Projects/Final.md")).toBe("# Title\n\n## Empty\n## Final\nOld");

      const final = await obsidianEdit({ operation: "replace_section", path: "Projects/Final.md", heading: "## Final", content: "New final", dryRun: false }, { vaultRoot });
      expect(final.status).toBe("success");
      expect(await readNote(vaultRoot, "Projects/Final.md")).toBe("# Title\n\n## Empty\n## Final\nNew final");
    });
  });

  it("fails deterministically for duplicate, missing, or invalid headings without mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Duplicate.md", "# Title\n\n## Plan\nFirst\n\n## Plan\nSecond\n");
      const original = await readNote(vaultRoot, "Projects/Duplicate.md");
      const duplicate = await obsidianEdit({ operation: "replace_section", path: "Projects/Duplicate.md", heading: "## Plan", content: "Replacement", dryRun: false }, { vaultRoot });
      expect(duplicate).toMatchObject({ status: "ambiguous", committed: false, error: { code: "DUPLICATE_HEADING", details: { count: 2 } } });
      expect(await readNote(vaultRoot, "Projects/Duplicate.md")).toBe(original);

      const missing = await obsidianEdit({ operation: "insert_under_heading", path: "Projects/Duplicate.md", heading: "## Missing", content: "Text", dryRun: false }, { vaultRoot });
      expect(missing).toMatchObject({ status: "not_found", committed: false, error: { code: "HEADING_NOT_FOUND" } });

      const invalid = await obsidianEdit({ operation: "replace_section", path: "Projects/Duplicate.md", heading: "Plan", content: "Text", dryRun: false }, { vaultRoot });
      expect(invalid).toMatchObject({ status: "validation_error", committed: false, error: { code: "INVALID_HEADING" } });
    });
  });
});
