import { describe, expect, it } from "vitest";
import { obsidianValidate } from "../src/validation-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";
import { executeTool, registerVaultExtensionForTest, seedNote, vaultSnapshot, withTempVault } from "./write-test-utils.js";

function validationBackend(): FakeObsidianCliBackend {
  return new FakeObsidianCliBackend().addNote({
    path: "Projects/Plan.md",
    title: "Plan",
    content: [
      "---",
      "status: active",
      "status: duplicate",
      "---",
      "# Different Title",
      "See [broken](../Secrets.md).",
      "## Goals",
      "## Goals",
    ].join("\n"),
  });
}

describe("obsidian_validate tool", () => {
  it("validates one existing explicit note with bounded deterministic output and no content dump", async () => {
    const backend = validationBackend();
    const result = await obsidianValidate(backend, { target: "existing_note", path: "Projects/Plan.md", budget: "standard" });
    const repeat = await obsidianValidate(validationBackend(), { target: "existing_note", path: "Projects/Plan.md", budget: "standard" });

    expect(result).toMatchObject({
      tool: "obsidian_validate",
      status: "success",
      target: "existing_note",
      path: "Projects/Plan.md",
      valid: true,
      summary: { workflowNeutral: true, checkedScope: "existing_note", errorCount: 0 },
    });
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["FRONTMATTER_DUPLICATE_KEY", "DUPLICATE_HEADING", "SUSPICIOUS_TRAVERSAL_PATH", "TITLE_PATH_MISMATCH"]));
    expect(result.issues.find((issue) => issue.code === "SUSPICIOUS_TRAVERSAL_PATH")?.severity).toBe("warning");
    expect(JSON.stringify(result)).not.toContain("status: active");
    expect(result).toEqual(repeat);
    expect(backend.readPaths()).toEqual(["Projects/Plan.md"]);
  });

  it("returns not_found without leaking absolute paths", async () => {
    const result = await obsidianValidate(validationBackend(), { target: "existing_note", path: "Projects/Missing.md" });

    expect(result).toMatchObject({ status: "not_found", valid: false, path: "Projects/Missing.md", error: { code: "NOTE_NOT_FOUND", category: "not_found" } });
    expect(JSON.stringify(result)).not.toMatch(/\/tmp\//);
  });

  it("does not mutate a local vault while validating an existing note", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Local\n");
      const before = await vaultSnapshot(vaultRoot);
      await obsidianValidate(validationBackend(), { target: "existing_note", path: "Projects/Plan.md" });
      expect(await vaultSnapshot(vaultRoot)).toEqual(before);
    });
  });

  it("validates proposed content without requiring a path, vault setup, or backend health", async () => {
    await withTempVault(async (vaultRoot) => {
      const backend = validationBackend();
      backend.available = false;
      const { pi } = registerVaultExtensionForTest(vaultRoot, backend);
      const result = await executeTool<any>(pi, "obsidian_validate", { target: "proposed_content", content: "# Plan\nSee [broken](../Secrets.md).", budget: "tiny" });

      expect(result).toMatchObject({ status: "success", target: "proposed_content", valid: true, summary: { checkedScope: "proposed_content", errorCount: 0 } });
      expect(result).not.toHaveProperty("path");
      expect(result.issues.find((issue: any) => issue.code === "SUSPICIOUS_TRAVERSAL_PATH")?.severity).toBe("warning");
      expect(backend.calls).toEqual([]);
    });
  });

  it("refuses unsafe registered existing-note paths before backend health checks", async () => {
    await withTempVault(async (vaultRoot) => {
      const backend = validationBackend();
      backend.available = false;
      const { pi } = registerVaultExtensionForTest(vaultRoot, backend);
      const result = await executeTool<any>(pi, "obsidian_validate", { target: "existing_note", path: "/tmp/outside.md" });

      expect(result).toMatchObject({ status: "safety_refusal", valid: false, error: { code: "UNSAFE_PATH" } });
      expect(backend.calls).toEqual([]);
    });
  });

  it("returns deterministic validation_error responses for invalid request shapes", async () => {
    const cases: Array<[unknown, string]> = [
      [{}, "MISSING_TARGET"],
      [{ target: "folder" }, "UNSUPPORTED_TARGET"],
      [{ target: "existing_note" }, "MISSING_PATH"],
      [{ target: "existing_note", path: 42 }, "PATH_NOT_STRING"],
      [{ target: "proposed_content" }, "MISSING_CONTENT"],
      [{ target: "proposed_content", content: "   \n" }, "EMPTY_CONTENT"],
      [{ target: "proposed_content", content: 42 }, "CONTENT_NOT_STRING"],
      [{ target: "proposed_content", content: "# Plan", expectedPath: 42 }, "EXPECTED_PATH_NOT_STRING"],
      [{ target: "proposed_content", content: "# Plan", maxIssues: 0 }, "INVALID_MAX_ISSUES"],
    ];

    for (const [request, code] of cases) {
      const result = await obsidianValidate(validationBackend(), request as any);
      expect(result).toMatchObject({ status: "validation_error", valid: false, issueCount: 0, error: { code } });
      expect(result.issues).toEqual([]);
    }
  });

  it("caps returned issues deterministically while preserving total counts", async () => {
    const content = ["[bad](oops", "See [a](../A.md).", "See [b](../B.md).", "See [c](../C.md).", "## Empty", "## Empty"].join("\n");
    const result = await obsidianValidate(undefined, { target: "proposed_content", content, maxIssues: 2, budget: "tiny" });

    expect(result.status).toBe("success");
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]?.severity).toBe("error");
    expect(result.issueCount).toBeGreaterThan(2);
    expect(result.summary.omittedIssueCount).toBeGreaterThan(0);
    expect(result.degradedSignals).toEqual(expect.arrayContaining(["issues_truncated"]));
  });
});
