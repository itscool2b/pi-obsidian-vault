import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("process safety", () => {
  it("centralizes process spawning in the Obsidian CLI adapter and never uses shell/network APIs", async () => {
    const files = await sourceFiles(path.join(process.cwd(), "src"));
    const intentionalWriteFiles = new Set(["src/vault-writer.ts", "src/write-engine.ts", "src/write-guidance.ts", "src/write-types.ts", "src/vault-editor.ts", "src/edit-engine.ts", "src/edit-guidance.ts", "src/edit-types.ts", "src/markdown-section-editor.ts", "src/frontmatter-editor.ts", "src/exact-text-editor.ts", "src/vault-manager.ts", "src/manage-engine.ts", "src/manage-guidance.ts", "src/manage-types.ts", "src/target-lock.ts"]);
    expect(files.map((file) => path.relative(process.cwd(), file))).toContain("src/agent-guidance.ts");
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const relative = path.relative(process.cwd(), file);
      if (/child_process|\bspawn\(|execFile\(|fork\(/.test(text)) {
        expect(relative).toBe("src/obsidian-cli.ts");
      }
      expect(text).not.toMatch(/shell:\s*true/);
      expect(text).not.toMatch(/\bfetch\(|https?\.request|net\.connect/);
      if (!intentionalWriteFiles.has(relative)) {
        expect(text).not.toMatch(/\b(open|create|append|prepend|rename|delete|move)\s*\(/);
      }
      if (relative === "src/vault-manager.ts") {
        expect(text).not.toMatch(/\b(unlink|rm|rmdir|remove)\s*\(/);
        expect(text).not.toMatch(/node:fs\/promises[\s\S]*\b(unlink|rm|rmdir)\b/);
      } else expect(text).not.toMatch(/\b(rename|unlink|rm|rmdir)\s*\(/);
    }
  });

  it("does not contain filesystem-first discovery calls in retrieval modules", async () => {
    const retrievalFiles = ["src/candidate-collector.ts", "src/retrieval-engine.ts", "src/metadata-enricher.ts"];
    for (const file of retrievalFiles) {
      const text = await readFile(path.join(process.cwd(), file), "utf8");
      expect(text).not.toMatch(/fast-glob|glob\(|readdir\(|readFile\(/);
    }
  });
});
