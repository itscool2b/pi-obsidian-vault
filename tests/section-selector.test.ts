import { describe, expect, it } from "vitest";
import { rankCandidates } from "../src/ranker.js";
import { selectSectionsForCandidates, splitMarkdownSections } from "../src/section-selector.js";
import type { EnrichedCandidateSeed } from "../src/metadata-enricher.js";
import { seededFakeCli } from "./fake-obsidian-cli.js";

describe("section selector", () => {
  it("splits headings, scores relevant sections, clips excerpts, and reads only selected paths", async () => {
    const sections = splitMarkdownSections("# A\nalpha\n## Target\nbeta gamma\n## Other\ndelta");
    expect(sections.map((section) => section.heading)).toEqual(["A", "Target", "Other"]);

    const backend = seededFakeCli();
    const seed: EnrichedCandidateSeed = {
      path: "Research/Integrated Gradients/index.md",
      title: "Integrated Gradients",
      evidence: [{ signal: "heading", field: "heading", matched: "Implementation", line: 5 }],
      searchLines: [],
      sourceCommands: ["test"],
      metadata: { headings: [{ text: "Implementation", line: 5 }] },
    };
    const ranked = rankCandidates([seed], "implementation", { maxCandidates: 1, previewChars: 200 });
    const result = await selectSectionsForCandidates(backend, ranked, "implementation", { sectionsPerNote: 1, sectionChars: 80, perNoteChars: 80 });
    const selected = result.get("Research/Integrated Gradients/index.md") ?? [];

    expect(selected[0]?.heading).toBe("Implementation");
    expect(selected[0]?.excerpt.length).toBeLessThanOrEqual(80);
    expect(backend.readPaths()).toEqual(["Research/Integrated Gradients/index.md"]);
  });
});
