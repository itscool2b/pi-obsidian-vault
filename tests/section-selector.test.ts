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

  it("does not select Project Narrative sections mainly because of stopwords", async () => {
    const backend = seededFakeCli();
    const seed: EnrichedCandidateSeed = {
      path: "Projects/Project Narrative.md",
      title: "Project Narrative",
      evidence: [{ signal: "exact_file", field: "selected", matched: "Project Narrative" }],
      searchLines: [],
      sourceCommands: ["selected"],
      metadata: { headings: [{ text: "Background", line: 3 }, { text: "Progress Timeline", line: 5 }, { text: "Current State", line: 7 }] },
    };
    const ranked = rankCandidates([seed], "what is this project and how did it progress?", { maxCandidates: 1, previewChars: 200 });
    const result = await selectSectionsForCandidates(backend, ranked, "what is this project and how did it progress?", { sectionsPerNote: 2, sectionChars: 900, perNoteChars: 1800 });
    const selected = result.get("Projects/Project Narrative.md") ?? [];

    expect(selected[0]?.heading).toBe("Progress Timeline");
    expect(selected[0]?.reasons.join(" ")).toMatch(/progress/i);
    expect(selected[0]?.reasons.join(" ")).not.toMatch(/\bwhat\b|\bis\b|\bthis\b|\band\b|\bhow\b|\bdid\b|\bit\b/);
  });

  it("uses selected exact paths for note validity while ranking sections by topic and progress intent over generic project overlap", async () => {
    const backend = seededFakeCli();
    backend.addNote({
      path: "Projects/Project Narrative.md",
      title: "Project Narrative",
      tags: ["project", "narrative"],
      properties: { project: "Pi", status: "active" },
      content: "# Project Narrative\n## TLDR\nThis read-only retrieval extension is a candidate-first way to answer Obsidian questions from selected notes.\n## Phase Progression\nThe work progressed through discovery, phase two ranking hardening, and context section selection fixes.\n## What's left\nThe project still has generic cleanup notes and leftover details.",
    });
    const seed: EnrichedCandidateSeed = {
      path: "Projects/Project Narrative.md",
      title: "Project Narrative",
      evidence: [{ signal: "exact_file", field: "selected", matched: "Projects/Project Narrative.md" }],
      searchLines: [],
      sourceCommands: ["selected"],
      metadata: { headings: [{ text: "TLDR", line: 2 }, { text: "Phase Progression", line: 4 }, { text: "What's left", line: 6 }] },
    };
    const ranked = rankCandidates([seed], "what the project is and how it progressed", { maxCandidates: 1, previewChars: 200 });
    const result = await selectSectionsForCandidates(backend, ranked, "what the project is and how it progressed", { sectionsPerNote: 4, sectionChars: 900, perNoteChars: 3600 });
    const selected = result.get("Projects/Project Narrative.md") ?? [];
    const headings = selected.map((section) => section.heading);
    const tldrIndex = headings.indexOf("TLDR");
    const progressionIndex = headings.indexOf("Phase Progression");
    const whatsLeftIndex = headings.indexOf("What's left");

    expect(ranked[0]?.path).toBe("Projects/Project Narrative.md");
    expect(tldrIndex).toBeGreaterThanOrEqual(0);
    expect(progressionIndex).toBeGreaterThanOrEqual(0);
    expect(whatsLeftIndex).toBeGreaterThanOrEqual(0);
    expect(tldrIndex).toBeLessThan(whatsLeftIndex);
    expect(progressionIndex).toBeLessThan(whatsLeftIndex);
    expect(selected[whatsLeftIndex]?.reasons.join(" ")).toMatch(/generic-term overlap "project"/i);
    expect(selected[whatsLeftIndex]?.reasons.join(" ")).not.toMatch(/section intent|progress|phase|tldr|overview/i);
  });
});
