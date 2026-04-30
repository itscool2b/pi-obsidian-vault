import { describe, expect, it } from "vitest";
import { obsidianEdit } from "../src/edit-engine.js";
import { expectNoLocalPathLeak, expectNoteUnchanged, readNote, seedNote, withTempVault } from "./write-test-utils.js";

describe("obsidian_edit replace_exact_text", () => {
  it("previews exact literal replacements without mutating and respects case, whitespace, and line endings", async () => {
    await withTempVault(async (vaultRoot) => {
      const content = "# Exact\r\n\r\nAlpha beta.\r\nCaseWord\r\nSpacing  test\r\n";
      await seedNote(vaultRoot, "Projects/Exact.md", content);

      const preview = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Exact.md", oldText: "CaseWord", newText: "caseword" }, { vaultRoot });
      expect(preview).toMatchObject({
        tool: "obsidian_edit",
        status: "preview",
        operation: "replace_exact_text",
        path: "Projects/Exact.md",
        dryRun: true,
        committed: false,
        preview: {
          targetKind: "exact_text",
          change: "replace",
          oldTextPreview: "CaseWord",
          newTextPreview: "caseword",
          oldTextChars: 8,
          newTextChars: 8,
          changedChars: 0,
          changedBytes: 0,
        },
      });
      expect(preview.preview?.beforePreview).toContain("CaseWord");
      expect(preview.preview?.afterPreview).toContain("caseword");
      await expectNoteUnchanged(vaultRoot, "Projects/Exact.md", content);
      expectNoLocalPathLeak(preview, vaultRoot);

      const caseMismatch = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Exact.md", oldText: "caseword", newText: "x" }, { vaultRoot });
      expect(caseMismatch).toMatchObject({ status: "not_found", committed: false, error: { code: "OLD_TEXT_NOT_FOUND" } });

      const whitespaceMismatch = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Exact.md", oldText: "Spacing test", newText: "x" }, { vaultRoot });
      expect(whitespaceMismatch).toMatchObject({ status: "not_found", committed: false, error: { code: "OLD_TEXT_NOT_FOUND" } });

      const lineEndingMismatch = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Exact.md", oldText: "Alpha beta.\n", newText: "x" }, { vaultRoot });
      expect(lineEndingMismatch).toMatchObject({ status: "not_found", committed: false, error: { code: "OLD_TEXT_NOT_FOUND" } });
      await expectNoteUnchanged(vaultRoot, "Projects/Exact.md", content);
    });
  });

  it("returns validation errors for missing exact-text request fields", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Validation.md", "# Validation\nText\n");
      expect(await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Validation.md", newText: "x" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_OLD_TEXT" } });
      expect(await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Validation.md", oldText: "", newText: "x" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_OLD_TEXT" } });
      expect(await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Validation.md", oldText: "Text" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_NEW_TEXT" } });
      expect(await obsidianEdit({ operation: "replace_exact_text", oldText: "Text", newText: "x" }, { vaultRoot })).toMatchObject({ status: "validation_error", error: { code: "MISSING_PATH" } });
    });
  });

  it("commits one unique exact replacement while preserving surrounding content", async () => {
    await withTempVault(async (vaultRoot) => {
      const original = "# Commit\n\nBefore unique span after.\n\nTail\n";
      await seedNote(vaultRoot, "Projects/Commit.md", original);
      const result = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Commit.md", oldText: "unique span", newText: "replacement span", dryRun: false }, { vaultRoot });
      expect(result).toMatchObject({ status: "success", committed: true, operation: "replace_exact_text", preview: { targetKind: "exact_text", changedChars: 5, changedBytes: 5 } });
      expect(await readNote(vaultRoot, "Projects/Commit.md")).toBe("# Commit\n\nBefore replacement span after.\n\nTail\n");
      expectNoLocalPathLeak(result, vaultRoot);
    });
  });

  it("fails deterministically for missing, duplicate, and full-note matches without mutation", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Failures.md", "# Failures\n\nRepeat me.\n\nRepeat me.\n");
      const original = await readNote(vaultRoot, "Projects/Failures.md");

      const missing = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Failures.md", oldText: "Not present", newText: "x", dryRun: false }, { vaultRoot });
      expect(missing).toMatchObject({ status: "not_found", committed: false, error: { code: "OLD_TEXT_NOT_FOUND", category: "not_found" } });
      await expectNoteUnchanged(vaultRoot, "Projects/Failures.md", original);

      const duplicate = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Failures.md", oldText: "Repeat me.", newText: "x", dryRun: false }, { vaultRoot });
      expect(duplicate).toMatchObject({ status: "ambiguous", committed: false, error: { code: "DUPLICATE_OLD_TEXT", category: "ambiguous", details: { count: 2 } } });
      await expectNoteUnchanged(vaultRoot, "Projects/Failures.md", original);

      await seedNote(vaultRoot, "Projects/Whole.md", "Only this text.\n");
      const whole = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Whole.md", oldText: "Only this text.\n", newText: "New whole note.\n", dryRun: false }, { vaultRoot });
      expect(whole).toMatchObject({ status: "safety_refusal", committed: false, error: { code: "FULL_NOTE_REPLACEMENT", category: "safety" } });
      await expectNoteUnchanged(vaultRoot, "Projects/Whole.md", "Only this text.\n");
    });
  });

  it("handles multiline, explicit empty, identical, overlapping, and multibyte replacements deterministically", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Values.md", "# Values\n\nA\nB\nC\n\nRemove me.\n\nSame.\n\ncafé\n\naaa\n");

      const multiline = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Values.md", oldText: "A\nB\nC", newText: "A\nBee\nC", dryRun: false }, { vaultRoot });
      expect(multiline.status).toBe("success");
      expect(await readNote(vaultRoot, "Projects/Values.md")).toContain("A\nBee\nC");

      const empty = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Values.md", oldText: "Remove me.", newText: "", dryRun: false }, { vaultRoot });
      expect(empty).toMatchObject({ status: "success", preview: { newTextChars: 0, changedChars: -10, changedBytes: -10 } });
      expect(await readNote(vaultRoot, "Projects/Values.md")).not.toContain("Remove me.");

      const identical = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Values.md", oldText: "Same.", newText: "Same.", dryRun: false }, { vaultRoot });
      expect(identical).toMatchObject({ status: "success", preview: { changedChars: 0, changedBytes: 0 } });

      const multibyte = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Values.md", oldText: "café", newText: "tea", dryRun: false }, { vaultRoot });
      expect(multibyte).toMatchObject({ status: "success", preview: { changedChars: -1, changedBytes: -2 } });

      const overlapping = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Values.md", oldText: "aa", newText: "z", dryRun: false }, { vaultRoot });
      expect(overlapping).toMatchObject({ status: "ambiguous", committed: false, error: { code: "DUPLICATE_OLD_TEXT", details: { count: 2 } } });
    });
  });

  it("revalidates current note state at commit time", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Revalidate.md", "# Revalidate\n\nOriginal text.\n");
      const preview = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Revalidate.md", oldText: "Original text.", newText: "Replacement text." }, { vaultRoot });
      expect(preview.status).toBe("preview");

      await seedNote(vaultRoot, "Projects/Revalidate.md", "# Revalidate\n\nChanged elsewhere.\n");
      const commit = await obsidianEdit({ operation: "replace_exact_text", path: "Projects/Revalidate.md", oldText: "Original text.", newText: "Replacement text.", dryRun: false }, { vaultRoot });
      expect(commit).toMatchObject({ status: "not_found", committed: false, error: { code: "OLD_TEXT_NOT_FOUND" } });
      await expectNoteUnchanged(vaultRoot, "Projects/Revalidate.md", "# Revalidate\n\nChanged elsewhere.\n");
    });
  });
});
