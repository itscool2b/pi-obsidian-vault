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
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const relative = path.relative(process.cwd(), file);
      if (/child_process|\bspawn\(|execFile\(|fork\(/.test(text)) {
        expect(relative).toBe("src/obsidian-cli.ts");
      }
      expect(text).not.toMatch(/shell:\s*true/);
      expect(text).not.toMatch(/\bfetch\(|https?\.request|net\.connect/);
      expect(text).not.toMatch(/\b(open|create|append|prepend|rename|delete|move)\s*\(/);
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
