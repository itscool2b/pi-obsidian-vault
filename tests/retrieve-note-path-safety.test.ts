import { describe, expect, it } from "vitest";
import { obsidianRetrieve } from "../src/retrieval-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";

describe("obsidian_retrieve mode=note path safety", () => {
  it("refuses unsafe explicit note paths before reading", async () => {
    const unsafePaths = [
      "/etc/passwd",
      "C:\\Users\\Ada\\Vault\\Plan.md",
      "\\\\server\\share\\Plan.md",
      "../Plan.md",
      "Projects/%2e%2e/Plan.md",
      ".hidden/Plan.md",
      ".obsidian/app.json",
      "Projects/*.md",
      "Projects/**/Plan.md",
      "Projects/A.md,Projects/B.md",
      "Projects/A.md;Projects/B.md",
      "Projects/A.md Projects/B.md",
    ];

    for (const unsafe of unsafePaths) {
      const backend = new FakeObsidianCliBackend();
      const result = await obsidianRetrieve(backend, { mode: "note", path: unsafe });

      expect(result.status, unsafe).toBe("safety_refusal");
      expect(result.exists).toBe(false);
      expect(backend.readPaths()).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(unsafe);
      expect(JSON.stringify(result)).not.toMatch(/\/etc|Users\\Ada|server\\share/);
    }
  });

  it("returns validation_error for missing, non-string, and non-Markdown note paths", async () => {
    const missingPath = await obsidianRetrieve(new FakeObsidianCliBackend(), { mode: "note" });
    expect(missingPath).toMatchObject({ status: "validation_error", error: { code: "MISSING_PATH" } });

    const nonString = await obsidianRetrieve(new FakeObsidianCliBackend(), { mode: "note", path: ["Projects/Plan.md", "Projects/Other.md"] } as any);
    expect(nonString).toMatchObject({ status: "validation_error", error: { code: "NOTE_PATH_NOT_STRING" } });

    const backend = new FakeObsidianCliBackend();
    const nonMarkdown = await obsidianRetrieve(backend, { mode: "note", path: "Projects/Plan.txt" });
    expect(nonMarkdown).toMatchObject({ status: "validation_error", error: { code: "NOTE_NOT_MARKDOWN" } });
    expect(backend.readPaths()).toEqual([]);
  });

  it("refuses selected and scope fields for note mode to prevent broad inspection", async () => {
    const backend = new FakeObsidianCliBackend();
    const result = await obsidianRetrieve(backend, { mode: "note", path: "Projects/Plan.md", selected: [{ path: "Projects/Plan.md" }] });
    const emptySelected = await obsidianRetrieve(backend, { mode: "note", path: "Projects/Plan.md", selected: [] });

    expect(result).toMatchObject({ status: "validation_error", error: { code: "NOTE_MODE_PATH_ONLY" } });
    expect(emptySelected).toMatchObject({ status: "validation_error", error: { code: "NOTE_MODE_PATH_ONLY" } });
    expect(backend.readPaths()).toEqual([]);
  });
});
