import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { expectNoLocalPathLeak, readNote, seedNote, withTempVault } from "./write-test-utils.js";

const baseNote = `---
status: draft
tags: [test]
---
# Smoke

Intro.

## Plan

Old plan.

## Log

Existing log.
`;

describe("obsidian_edit dry-run previews", () => {
  it("previews every supported operation without mutating the note", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Smoke.md", baseNote);
      const original = await readNote(vaultRoot, "Projects/Smoke.md");
      const requests = [
        { operation: "replace_section", path: "Projects/Smoke.md", heading: "## Plan", content: "New plan." },
        { operation: "insert_under_heading", path: "Projects/Smoke.md", heading: "## Log", content: "- New entry.\n" },
        { operation: "update_frontmatter", path: "Projects/Smoke.md", property: "status", value: "reviewed" },
        { operation: "remove_frontmatter", path: "Projects/Smoke.md", property: "tags" },
        { operation: "replace_exact_text", path: "Projects/Smoke.md", oldText: "Existing log.", newText: "Updated log." },
      ];
      for (const request of requests) {
        const result = await obsidianEdit(request, { vaultRoot });
        expect(result.status).toBe("preview");
        expect(result.dryRun).toBe(true);
        expect(result.committed).toBe(false);
        expect(result.preview).toMatchObject({ path: "Projects/Smoke.md", operation: request.operation });
        expect(result.nextActions.map((action) => action.action)).toContain("confirm_preview");
        expect(await readNote(vaultRoot, "Projects/Smoke.md")).toBe(original);
        expectNoLocalPathLeak(result, vaultRoot);
      }
    });
  });

  it("preserves normal-sized section previews without returning full note bodies", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Long.md", "# Long\n\n## Plan\n\nOld\n");
      const long = "x".repeat(900);
      const result = await obsidianEdit({ operation: "replace_section", path: "Projects/Long.md", heading: "## Plan", content: long }, { vaultRoot });
      expect(result.status).toBe("preview");
      expect(result.preview?.contentChars).toBe(900);
      expect(result.preview?.previewTruncated).toBe(false);
      expect((result.preview?.afterPreview?.length ?? 0)).toBeGreaterThanOrEqual(900);
      expect(JSON.stringify(result)).toContain(long);
    });
  });

  it("preserves normal-sized exact-text previews and allows explicit empty replacement without mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      const oldText = `START ${"x".repeat(900)} END`;
      const original = `# Long Exact\n\nBefore\n${oldText}\nAfter\n`;
      await seedNote(vaultRoot, "Projects/Long Exact.md", original);
      const result = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Long Exact.md", oldText, newText: "" }, { vaultRoot });
      expect(result.status).toBe("preview");
      expect(result.preview).toMatchObject({ targetKind: "exact_text", change: "replace", oldTextChars: oldText.length, newTextChars: 0, changedChars: -oldText.length });
      expect(result.preview?.previewTruncated).toBe(false);
      expect((result.preview?.oldTextPreview?.length ?? 0)).toBe(oldText.length);
      expect(await readNote(vaultRoot, "Projects/Long Exact.md")).toBe(original);
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });
});
