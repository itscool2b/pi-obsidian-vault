import { describe, expect, it } from "vitest";
import { parseMarkdownNote } from "../src/note-parser.js";

describe("shared Markdown note parser", () => {
  it("extracts frontmatter keys, note type, headings, duplicates, links, counts, and preview deterministically", () => {
    const content = [
      "---",
      "type: project-note",
      "status: active",
      "aliases: [Plan]",
      "---",
      "# Project Plan",
      "See [[Projects/Roadmap|Roadmap]] and ![[Assets/Image.png]].",
      "Also see [Design](Design.md) and ![Alt](Images/diagram.png).",
      "## Goals",
      "Ship the parser.",
      "### Child",
      "Details.",
      "## Goals",
      "Duplicate heading.",
    ].join("\n");

    const first = parseMarkdownNote(content, { previewChars: 80 });
    const second = parseMarkdownNote(content, { previewChars: 80 });

    expect(second).toEqual(first);
    expect(first.noteType).toBe("project-note");
    expect(first.frontmatterKeys).toEqual(["type", "status", "aliases"]);
    expect(first.frontmatter).toMatchObject({ exists: true, hasClosingDelimiter: true, malformed: false, nonObject: false, startLine: 1, endLine: 5 });
    expect(first.firstHeading).toMatchObject({ text: "Project Plan", level: 1, line: 6 });
    expect(first.headings.map((heading) => [heading.text, heading.level])).toEqual([
      ["Project Plan", 1],
      ["Goals", 2],
      ["Child", 3],
      ["Goals", 2],
    ]);
    expect(first.duplicateHeadingWarnings).toEqual([{ heading: "Goals", normalizedHeading: "goals", occurrences: 2, lines: [9, 13], message: "Heading \"Goals\" appears 2 times; section targeting may be ambiguous." }]);
    expect(first.outgoingWikiLinks).toEqual([
      { raw: "Projects/Roadmap|Roadmap", target: "Projects/Roadmap", alias: "Roadmap", embed: false, line: 7 },
      { raw: "Assets/Image.png", target: "Assets/Image.png", embed: true, line: 7 },
    ]);
    expect(first.outgoingMarkdownLinks).toEqual([
      { text: "Design", target: "Design.md", isImage: false, isExternal: false, line: 8 },
      { text: "Alt", target: "Images/diagram.png", isImage: true, isExternal: false, line: 8 },
    ]);
    expect(first.approximateCharCount).toBe(content.length);
    expect(first.approximateLineCount).toBe(14);
    expect(first.preview?.length).toBeLessThanOrEqual(80);
    expect(first.degradedSignals).toEqual(["preview", "budget"]);
  });

  it("orders duplicate heading warnings by first duplicate occurrence then normalized heading", () => {
    const parsed = parseMarkdownNote("# Alpha\n# Beta\n# Beta\n# Alpha\n# Aardvark\n# Aardvark");

    expect(parsed.duplicateHeadingWarnings.map((warning) => warning.normalizedHeading)).toEqual(["beta", "alpha", "aardvark"]);
  });

  it("reports malformed frontmatter as degraded without throwing", () => {
    const parsed = parseMarkdownNote("---\ntype: broken\n# Heading\nBody");

    expect(parsed.frontmatterKeys).toEqual([]);
    expect(parsed.frontmatter).toMatchObject({ exists: true, hasClosingDelimiter: false, malformed: true, duplicateKeys: [] });
    expect(parsed.warnings.join("\n")).toMatch(/frontmatter/i);
    expect(parsed.degradedSignals).toEqual(["metadata", "parsing"]);
  });

  it("tracks duplicate, malformed, and non-object frontmatter signals for validation", () => {
    const duplicate = parseMarkdownNote("---\nstatus: active\nstatus: duplicate\n---\n# Heading");
    expect(duplicate.frontmatter?.duplicateKeys).toEqual([{ key: "status", line: 3 }]);
    expect(duplicate.frontmatter?.keyLines).toEqual([{ key: "status", line: 2 }, { key: "status", line: 3 }]);

    const malformed = parseMarkdownNote("---\nnot yaml\n---\n# Heading");
    expect(malformed.frontmatter).toMatchObject({ malformed: true, nonObject: false });

    const nonObject = parseMarkdownNote("---\n- item\n---\n# Heading");
    expect(nonObject.frontmatter).toMatchObject({ malformed: false, nonObject: true });
  });
});
