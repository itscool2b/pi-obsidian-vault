import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release documentation and skill guidance", () => {
  it("documents the public surface, operations, workflow, dry-run model, limitations, recoverable trash, and restore", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const skill = readFileSync(new URL("../skills/obsidian-research/SKILL.md", import.meta.url), "utf8");

    for (const token of ["obsidian_retrieve", "obsidian_write", "obsidian_edit", "obsidian_manage", "/obsidian-vault"]) {
      expect(readme).toContain(token);
    }
    for (const operation of ["search", "context", "graph", "project", "create", "append", "create_folder", "replace_section", "insert_under_heading", "update_frontmatter", "remove_frontmatter", "replace_exact_text", "move_note", "trash_note", "restore_note"]) {
      expect(readme).toContain(operation);
    }

    expect(readme).toMatch(/Recommended agent workflow/i);
    expect(readme).toMatch(/retrieve candidates/i);
    expect(readme).toMatch(/selected context/i);
    expect(readme).toMatch(/dryRun[^\n]+true/i);
    expect(readme).toMatch(/dryRun[^\n]+false/i);
    expect(readme).toMatch(/unsupported operations|intentionally unsupported/i);
    expect(readme).toMatch(/recoverable move-to-trash/i);
    expect(readme).toMatch(/not permanent deletion/i);
    expect(readme).toMatch(/restore_note/i);
    expect(readme).toMatch(/trashPath/i);
    expect(readme).toMatch(/TRASH_PATH_OUTSIDE_TRASH/);

    expect(skill).toMatch(/candidate discovery/i);
    expect(skill).toMatch(/selectedRef/i);
    expect(skill).toMatch(/explicit safe vault-relative/i);
    expect(skill).toMatch(/dryRun/i);
    expect(skill).toMatch(/recoverable move-to-trash/i);
    expect(skill).toMatch(/restore_note/i);
    expect(skill).toMatch(/trashPath/i);
    expect(skill).toMatch(/Never use any Obsidian tool for full-note overwrite, permanent delete/i);
  });
});
