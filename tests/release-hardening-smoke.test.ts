import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ObsidianEditOutput, ObsidianManageOutput, ObsidianRetrieveOutput, ObsidianWriteOutput } from "../src/index.js";
import { executeTool, expectNoLocalPathLeak, folderExists, pathExists, readNote, registerVaultExtensionForTest, runStatusCommand, vaultSnapshot, withTempVault } from "./write-test-utils.js";
import { unexpectedFakeCliSideEffectCalls } from "./fake-obsidian-cli.js";
import { requireCapabilities } from "./status-test-utils.js";

describe("release hardening temporary-vault smoke", () => {
  it("keeps package metadata public-release-ready and package contents bounded", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      name: string;
      version: string;
      private?: boolean;
      description?: string;
      license?: string;
      repository?: { url?: string };
      keywords?: string[];
      pi?: { extensions?: string[]; skills?: string[] };
      files?: string[];
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    expect(packageJson.name).toBe("pi-obsidian-vault");
    expect(packageJson.version).toBe("0.2.0");
    expect(Object.hasOwn(packageJson, "private")).toBe(false);
    expect(packageJson.description).toMatch(/Agent-safe Obsidian vault access for Pi/i);
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.repository?.url).toMatch(/github\.com\/itscool2b\/pi-obsidian-vault/i);
    for (const keyword of ["pi-package", "pi-extension", "obsidian", "vault", "markdown", "retrieval", "validation", "planning", "safe-writing", "safe-editing", "safe-note-management", "agent-safe"]) {
      expect(packageJson.keywords).toContain(keyword);
    }
    expect(packageJson.pi?.extensions).toEqual(["./src/index.ts"]);
    expect(packageJson.pi?.skills).toEqual(["./skills/obsidian-research"]);
    expect(packageJson.files).toEqual(expect.arrayContaining(["src/", "skills/", "assets/", "README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md", "RELEASE.md"]));
    for (const forbidden of ["specs/", ".specify/", "tests/", "node_modules/", "coverage/"]) {
      expect(packageJson.files).not.toContain(forbidden);
    }
    expect(packageJson.scripts?.check).toBe("npm run typecheck && npm test");
    expect(packageJson.scripts?.prepublishOnly).toBe("npm run check");
    expect(packageJson.dependencies).toEqual({});
  });

  it("documents and preserves temporary/disposable vault posture for committed smoke tests", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const security = readFileSync(new URL("../SECURITY.md", import.meta.url), "utf8");
    const release = readFileSync(new URL("../RELEASE.md", import.meta.url), "utf8");
    const source = readFileSync(new URL("./release-hardening-smoke.test.ts", import.meta.url), "utf8");

    const evalVaultEnvName = "OBSIDIAN_EVAL_" + "VAULT";
    expect(source).toContain("withTempVault");
    expect(source).not.toContain(`process.env.${evalVaultEnvName}`);
    for (const doc of [readme, security, release]) {
      expect(doc).toMatch(/temporary or disposable vaults|temp\/disposable vaults/i);
      expect(doc).toMatch(/Real-vault.*opt-in|real-vault.*manual/i);
      expect(doc).not.toMatch(/run committed smoke tests against a real vault by default/i);
      expect(doc).toMatch(/no-overwrite|No overwrite/i);
      expect(doc).toMatch(/human approval|dryRun|dry-run/i);
      expect(doc).toMatch(/auto-write|approval/i);
      expect(doc).toMatch(/redact/i);
      expect(doc).toMatch(/no-shell\/network|shell\/network/i);
      expect(doc).toMatch(/no-broad-scan|broad vault scan/i);
    }
  });

  it("drives the full public tool lifecycle without touching a real vault", async () => {
    await withTempVault(async (vaultRoot) => {
      const { pi, backend } = registerVaultExtensionForTest(vaultRoot);
      const notePath = "Smoke/Workspace/Plan.md";
      const movedPath = "Smoke/Archive/Plan.md";
      const copyPath = "Smoke/Archive/Plan Copy.md";
      const trashPath = "_Trash/Plan.md";
      const initialContent = "# Plan\n\n## Log\nInitial line.\n\n## Section\nOld section text.\n\n## Tail\nEnd.\n";

      const previewFolder = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create_folder", path: "Smoke/Workspace" });
      expect(previewFolder).toMatchObject({ status: "preview", dryRun: true, committed: false, operation: "create_folder" });
      expect(await folderExists(vaultRoot, "Smoke/Workspace")).toBe(false);
      expectNoLocalPathLeak(previewFolder, vaultRoot);

      const commitFolder = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create_folder", path: "Smoke/Workspace", dryRun: false });
      expect(commitFolder).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await folderExists(vaultRoot, "Smoke/Workspace")).toBe(true);

      const previewCreate = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create", path: notePath, content: initialContent });
      expect(previewCreate).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await pathExists(vaultRoot, notePath)).toBe(false);

      const commitCreate = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create", path: notePath, content: initialContent, dryRun: false });
      expect(commitCreate).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toBe(initialContent);

      const previewAppend = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "append", path: notePath, content: "\nAppend marker: alpha.\n" });
      expect(previewAppend).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await readNote(vaultRoot, notePath)).toBe(initialContent);

      const commitAppend = await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "append", path: notePath, content: "\nAppend marker: alpha.\n", dryRun: false });
      expect(commitAppend).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toContain("Append marker: alpha.");

      const beforeRetrieve = await vaultSnapshot(vaultRoot);
      const retrieval = await executeTool<ObsidianRetrieveOutput>(pi, "obsidian_retrieve", { query: "create move trash restore copy delete Smoke Plan", mode: "search", budget: "tiny" });
      expect(retrieval.warnings.join("\n")).toMatch(/read-only/i);
      expect(unexpectedFakeCliSideEffectCalls(backend)).toEqual([]);
      expect(await vaultSnapshot(vaultRoot)).toEqual(beforeRetrieve);

      const previewSection = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "replace_section", path: notePath, heading: "## Section", content: "Updated section text." });
      expect(previewSection).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await readNote(vaultRoot, notePath)).toContain("Old section text.");

      const commitSection = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "replace_section", path: notePath, heading: "## Section", content: "Updated section text.", dryRun: false });
      expect(commitSection).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toContain("Updated section text.");

      const previewExact = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "replace_exact_text", path: notePath, oldText: "Append marker: alpha.", newText: "Append marker: beta." });
      expect(previewExact).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await readNote(vaultRoot, notePath)).toContain("Append marker: alpha.");

      const commitExact = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "replace_exact_text", path: notePath, oldText: "Append marker: alpha.", newText: "Append marker: beta.", dryRun: false });
      expect(commitExact).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toContain("Append marker: beta.");

      const previewFrontmatter = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "update_frontmatter", path: notePath, property: "status", value: "hardened" });
      expect(previewFrontmatter).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await readNote(vaultRoot, notePath)).not.toContain("status: hardened");

      const commitFrontmatter = await executeTool<ObsidianEditOutput>(pi, "obsidian_edit", { operation: "update_frontmatter", path: notePath, property: "status", value: "hardened", dryRun: false });
      expect(commitFrontmatter).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await readNote(vaultRoot, notePath)).toContain("status: hardened");

      await executeTool<ObsidianWriteOutput>(pi, "obsidian_write", { operation: "create_folder", path: "Smoke/Archive", dryRun: false });
      const beforeMoveContent = await readNote(vaultRoot, notePath);
      const previewMove = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "move_note", fromPath: notePath, toPath: movedPath });
      expect(previewMove).toMatchObject({ status: "preview", dryRun: true, committed: false });
      expect(await pathExists(vaultRoot, movedPath)).toBe(false);

      const commitMove = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "move_note", fromPath: notePath, toPath: movedPath, dryRun: false });
      expect(commitMove).toMatchObject({ status: "success", dryRun: false, committed: true });
      expect(await pathExists(vaultRoot, notePath)).toBe(false);
      expect(await readNote(vaultRoot, movedPath)).toBe(beforeMoveContent);

      const previewTrash = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "trash_note", path: movedPath });
      expect(previewTrash).toMatchObject({ status: "preview", dryRun: true, committed: false, trashFolder: "_Trash", trashPath });
      expect(await pathExists(vaultRoot, movedPath)).toBe(true);
      expect(await pathExists(vaultRoot, trashPath)).toBe(false);

      const commitTrash = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "trash_note", path: movedPath, dryRun: false });
      expect(commitTrash).toMatchObject({ status: "success", dryRun: false, committed: true, trashPath });
      expect(await pathExists(vaultRoot, movedPath)).toBe(false);
      expect(await readNote(vaultRoot, trashPath)).toBe(beforeMoveContent);

      const previewRestore = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "restore_note", trashPath, toPath: movedPath });
      expect(previewRestore).toMatchObject({ status: "preview", dryRun: true, committed: false, trashFolder: "_Trash", trashPath, toPath: movedPath });
      expect(await pathExists(vaultRoot, trashPath)).toBe(true);
      expect(await pathExists(vaultRoot, movedPath)).toBe(false);

      const commitRestore = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "restore_note", trashPath, toPath: movedPath, dryRun: false });
      expect(commitRestore).toMatchObject({ status: "success", dryRun: false, committed: true, trashPath, toPath: movedPath });
      expect(await pathExists(vaultRoot, trashPath)).toBe(false);
      expect(await readNote(vaultRoot, movedPath)).toBe(beforeMoveContent);

      const previewCopy = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "copy_note", fromPath: movedPath, toPath: copyPath });
      expect(previewCopy).toMatchObject({ status: "preview", dryRun: true, committed: false, fromPath: movedPath, toPath: copyPath, preview: { wouldCopy: true } });
      expect(await pathExists(vaultRoot, copyPath)).toBe(false);
      expect(await readNote(vaultRoot, movedPath)).toBe(beforeMoveContent);

      const commitCopy = await executeTool<ObsidianManageOutput>(pi, "obsidian_manage", { operation: "copy_note", fromPath: movedPath, toPath: copyPath, dryRun: false });
      expect(commitCopy).toMatchObject({ status: "success", dryRun: false, committed: true, fromPath: movedPath, toPath: copyPath, target: { sourceExistsAfter: true, destinationExistsAfter: true, bytesPreserved: true } });
      expect(await readNote(vaultRoot, movedPath)).toBe(beforeMoveContent);
      expect(await readNote(vaultRoot, copyPath)).toBe(beforeMoveContent);

      const beforeFinalRetrieve = await vaultSnapshot(vaultRoot);
      await executeTool<ObsidianRetrieveOutput>(pi, "obsidian_retrieve", { query: "trash restore delete move copy Smoke Plan", mode: "search", budget: "tiny" });
      expect(await vaultSnapshot(vaultRoot)).toEqual(beforeFinalRetrieve);
      expect(unexpectedFakeCliSideEffectCalls(backend)).toEqual([]);

      const status = await runStatusCommand(pi);
      expect(status.message).toContain("Obsidian Vault: ready");
      expect(status.message).toContain("Vault: dev override");
      expect(status.message).not.toContain(vaultRoot);
      expect(status.message).not.toMatch(/\/tmp\/pi-obsidian-write-/);

      for (const output of [previewFolder, commitFolder, previewCreate, commitCreate, previewAppend, commitAppend, retrieval, previewSection, commitSection, previewExact, commitExact, previewFrontmatter, commitFrontmatter, previewMove, commitMove, previewTrash, commitTrash, previewRestore, commitRestore, previewCopy, commitCopy]) {
        expectNoLocalPathLeak(output, vaultRoot);
      }
    });
  });
});
