import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";
import { seedNote, vaultSnapshot, withTempVault } from "./write-test-utils.js";

function noteBackend(): FakeObsidianCliBackend {
  return new FakeObsidianCliBackend().addNote({
    path: "Projects/Plan.md",
    title: "Plan",
    content: [
      "---",
      "type: project-note",
      "status: active",
      "---",
      "# Project Plan",
      "See [[Projects/Roadmap|Roadmap]] and [Design](Design.md).",
      "## Goals",
      "Ship note inspection.",
      "## Goals",
      "Duplicate heading.",
    ].join("\n"),
  });
}

describe("obsidian_retrieve mode=note inspection", () => {
  it("returns bounded structured metadata for one explicit Markdown note", async () => {
    const backend = noteBackend();

    const result = await obsidianRetrieve(backend, { mode: "note", path: "Projects/Plan.md", budget: "standard", explain: true });
    const repeat = await obsidianRetrieve(noteBackend(), { mode: "note", path: "Projects/Plan.md", budget: "standard", explain: true });

    expect(result).toMatchObject({
      tool: "obsidian_retrieve",
      mode: "note",
      status: "success",
      path: "Projects/Plan.md",
      exists: true,
      noteType: "project-note",
      frontmatterKeys: ["type", "status"],
      firstHeading: { text: "Project Plan", level: 1, line: 5 },
      approximateCharCount: expect.any(Number),
      approximateLineCount: expect.any(Number),
      candidates: [],
    });
    expect(result.headings?.map((heading) => [heading.text, heading.level])).toEqual([["Project Plan", 1], ["Goals", 2], ["Goals", 2]]);
    expect(result.duplicateHeadingWarnings).toEqual([{ heading: "Goals", normalizedHeading: "goals", occurrences: 2, lines: [7, 9], message: "Heading \"Goals\" appears 2 times; section targeting may be ambiguous." }]);
    expect(result.outgoingWikiLinks).toEqual([{ raw: "Projects/Roadmap|Roadmap", target: "Projects/Roadmap", alias: "Roadmap", embed: false, line: 6 }]);
    expect(result.outgoingMarkdownLinks).toEqual([{ text: "Design", target: "Design.md", isImage: false, isExternal: false, line: 6 }]);
    expect(result.preview?.length ?? 0).toBeLessThanOrEqual(240);
    expect(result).toEqual(repeat);
    expect(backend.readPaths()).toEqual(["Projects/Plan.md"]);
  });

  it("omits preview by default so full note content is not returned", async () => {
    const result = await obsidianRetrieve(noteBackend(), { mode: "note", path: "Projects/Plan.md", budget: "standard" });

    expect(result.preview).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("Ship note inspection.");
  });

  it("returns not_found for a missing explicit note without leaking absolute paths", async () => {
    const result = await obsidianRetrieve(noteBackend(), { mode: "note", path: "Projects/Missing.md" });

    expect(result).toMatchObject({ status: "not_found", mode: "note", path: "Projects/Missing.md", exists: false, error: { code: "NOTE_NOT_FOUND", category: "not_found" } });
    expect(JSON.stringify(result)).not.toMatch(/\/tmp\//);
  });

  it("does not mutate a local vault during note inspection", async () => {
    await withTempVault(async (vaultRoot) => {
      await seedNote(vaultRoot, "Projects/Plan.md", "# Local\n");
      const before = await vaultSnapshot(vaultRoot);
      await obsidianRetrieve(noteBackend(), { mode: "note", path: "Projects/Plan.md" });
      expect(await vaultSnapshot(vaultRoot)).toEqual(before);
    });
  });
});
