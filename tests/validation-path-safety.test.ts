import { describe, expect, it } from "vitest";
import { obsidianValidate } from "../src/validation-engine.js";
import { FakeObsidianCliBackend } from "./fake-obsidian-cli.js";
import { UNSAFE_NOTE_PATHS } from "./release-hardening-fixtures.js";

function backend(): FakeObsidianCliBackend {
  return new FakeObsidianCliBackend().addNote({ path: "Projects/Plan.md", title: "Plan", content: "# Plan" });
}

describe("obsidian_validate path safety", () => {
  it("refuses unsafe existing-note paths before any note is read", async () => {
    for (const unsafe of [...UNSAFE_NOTE_PATHS, "Projects/*.md", "Projects/**/Plan.md", "Projects/One.md,Projects/Two.md", "Projects/One.md;Projects/Two.md"]) {
      const cli = backend();
      const result = await obsidianValidate(cli, { target: "existing_note", path: unsafe });

      expect(["safety_refusal", "validation_error"]).toContain(result.status);
      expect(result.valid).toBe(false);
      expect(cli.readPaths()).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("/tmp/outside.md");
      expect(JSON.stringify(result)).not.toContain("C:\\Users\\me\\outside.md");
    }
  });

  it("returns validation_error for non-string existing-note path", async () => {
    const cli = backend();
    const result = await obsidianValidate(cli, { target: "existing_note", path: 123 });

    expect(result).toMatchObject({ status: "validation_error", error: { code: "PATH_NOT_STRING" } });
    expect(cli.readPaths()).toEqual([]);
  });

  it("refuses unsafe expectedPath values without validating proposed content", async () => {
    for (const unsafe of [...UNSAFE_NOTE_PATHS, "Projects/*.md", "Projects/**/Plan.md", "Projects/One.md,Projects/Two.md"]) {
      const result = await obsidianValidate(undefined, { target: "proposed_content", content: "# Plan", expectedPath: unsafe });

      expect(["safety_refusal", "validation_error"]).toContain(result.status);
      expect(result.valid).toBe(false);
      expect(result.issueCount).toBe(0);
      expect(result.issues).toEqual([]);
    }
  });

  it("returns validation_error for non-string expectedPath", async () => {
    const result = await obsidianValidate(undefined, { target: "proposed_content", content: "# Plan", expectedPath: 123 });

    expect(result).toMatchObject({ status: "validation_error", error: { code: "EXPECTED_PATH_NOT_STRING" }, issueCount: 0 });
  });
});
