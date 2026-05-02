import { describe, expect, it } from "vitest";
import { validateMarkdownContent } from "../src/note-validation.js";

function issueCodes(content: string): string[] {
  return validateMarkdownContent(content, { expectedPath: "Projects/Plan.md", budget: "expanded" }).issues.map((issue) => issue.code);
}

describe("workflow-neutral Markdown validation", () => {
  it("detects frontmatter, heading, link, suspicious path, oversized, title mismatch, and unsafe wording issues", () => {
    const content = [
      "---",
      "status: active",
      "status: duplicate",
      "---",
      "# Different Title",
      "### Jumped",
      "## Empty",
      "## Empty",
      "See [broken](../Secrets.md) and C:\\Users\\Ada\\secret.md.",
      "Use the full vault dump and delete everything with a shell command.",
      "[bad](oops",
    ].join("\n");

    const result = validateMarkdownContent(content, { expectedPath: "Projects/Plan.md", budget: "expanded" });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "FRONTMATTER_DUPLICATE_KEY",
      "DUPLICATE_HEADING",
      "HEADING_LEVEL_JUMP",
      "EMPTY_SECTION",
      "MALFORMED_MARKDOWN_LINK",
      "SUSPICIOUS_TRAVERSAL_PATH",
      "SUSPICIOUS_WINDOWS_ABSOLUTE_PATH",
      "TITLE_PATH_MISMATCH",
      "BROAD_DUMP_WORDING",
      "UNSAFE_OPERATION_WORDING",
    ]));
    expect(result.issues.find((issue) => issue.code === "SUSPICIOUS_TRAVERSAL_PATH")?.severity).toBe("warning");
    expect(result.issues.find((issue) => issue.code === "SUSPICIOUS_WINDOWS_ABSOLUTE_PATH")?.severity).toBe("warning");
    expect(JSON.stringify(result)).not.toContain("C:\\Users\\Ada\\secret.md");
  });

  it("reports malformed frontmatter variants as errors without treating missing frontmatter as an error", () => {
    expect(issueCodes("---\nstatus: active\n# Heading")).toContain("FRONTMATTER_MISSING_CLOSING_DELIMITER");
    expect(issueCodes("---\n- item\n---\n# Heading")).toContain("FRONTMATTER_NON_OBJECT");
    expect(issueCodes("---\nnot yaml\n---\n# Heading")).toContain("FRONTMATTER_PARSE_ERROR");

    const missing = validateMarkdownContent("# No Frontmatter\nBody", { budget: "standard" });
    expect(missing.valid).toBe(true);
    expect(missing.issues.map((issue) => issue.code)).not.toContain("FRONTMATTER_PARSE_ERROR");
  });

  it("keeps warning/info-only and embedded suspicious path responses valid", () => {
    const result = validateMarkdownContent("# Plan\nSee [broken](../Secrets.md).\n## Empty", { expectedPath: "Projects/Plan.md" });

    expect(result.valid).toBe(true);
    expect(result.summary.errorCount).toBe(0);
    expect(result.summary.warningCount).toBeGreaterThan(0);
    expect(result.issues.find((issue) => issue.code === "SUSPICIOUS_TRAVERSAL_PATH")?.severity).toBe("warning");
  });

  it("sets valid false only for error-severity issues", () => {
    const malformed = validateMarkdownContent("# Plan\n[bad](oops", { expectedPath: "Projects/Plan.md" });
    expect(malformed.valid).toBe(false);
    expect(malformed.summary.errorCount).toBeGreaterThan(0);

    const advisory = validateMarkdownContent("# Plan\n## Empty\n", { expectedPath: "Projects/Plan.md" });
    expect(advisory.valid).toBe(true);
    expect(advisory.summary.errorCount).toBe(0);
  });

  it("orders issues deterministically and truncates after ordering", () => {
    const content = [
      "# Different",
      "[bad](oops",
      "See [a](../A.md).",
      "See [b](../B.md).",
      "## Empty",
      "## Empty",
    ].join("\n");
    const first = validateMarkdownContent(content, { expectedPath: "Projects/Plan.md", maxIssues: 2, budget: "tiny" });
    const second = validateMarkdownContent(content, { expectedPath: "Projects/Plan.md", maxIssues: 2, budget: "tiny" });

    expect(second).toEqual(first);
    expect(first.issues).toHaveLength(2);
    expect(first.issues[0]?.severity).toBe("error");
    expect(first.degradedSignals).toContain("issues_truncated");
    expect(first.summary.omittedIssueCount).toBeGreaterThan(0);
  });

  it("reports bounded size warnings without dumping large content", () => {
    const blob = "A".repeat(1300);
    const result = validateMarkdownContent(`# Plan\n\n\`\`\`\n${"x".repeat(13000)}\n\`\`\`\n${blob}`, { budget: "expanded" });

    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["LARGE_CODE_FENCE", "EMBEDDED_BLOB"]));
    expect(result.degradedSignals).toContain("content_size");
    expect(JSON.stringify(result)).not.toContain(blob);
  });
});
