import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readText = (relativePath: string): string => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const packageJson = JSON.parse(readText("package.json")) as {
  name: string;
  version: string;
  pi?: { extensions?: string[]; skills?: string[] };
};

describe("release documentation and skill guidance", () => {
  it("documents the simple public surface and workflows", () => {
    const readme = readText("README.md");
    const skill = readText("skills/obsidian-research/SKILL.md");

    for (const token of ["obsidian_config", "obsidian_retrieve", "obsidian_validate", "obsidian_plan", "obsidian_write", "obsidian_edit", "obsidian_manage", "obsidian_destroy", "/obsidian-vault"]) {
      expect(readme).toContain(token);
    }
    for (const operation of ["set_vault", "forget_vault", "status", "auto", "search", "context", "graph", "project", "note", "relationships", "create", "append", "create_folder", "replace_section", "insert_under_heading", "update_frontmatter", "remove_frontmatter", "replace_exact_text", "move_note", "trash_note", "restore_note", "copy_note", "delete_note", "delete_folder", "replace_note", "empty_trash"]) {
      expect(readme).toContain(operation);
    }

    expect(readme).toMatch(/only one normal persistent setting/i);
    expect(readme).toMatch(/vaultPath/i);
    expect(readme).toMatch(/OBSIDIAN_VAULT_PATH/);
    expect(readme).toMatch(/status[\s\S]+not[\s\S]+complete retrieval\/CLI health check/i);
    expect(readme).toMatch(/Auto-write this session/i);
    expect(readme).toMatch(/Auto-destroy this session/i);
    expect(readme).toMatch(/dryRun[\s\S]+true[\s\S]+never commits/i);
    expect(readme).toMatch(/human approval/i);
    expect(readme).toMatch(/recoverable move-to-trash/i);
    expect(readme).toMatch(/not permanent deletion/i);
    expect(readme).toMatch(/byte-for-byte/i);
    expect(readme).toMatch(/workflow-neutral/i);
    expect(readme).toMatch(/warning-severity advisory/i);
    expect(readme).toMatch(/never executes|never execute/i);
    expect(readme).toMatch(/no vault-wide backlink scan|no broad vault\/backlink scan/i);
    expect(readme).not.toMatch(/commitToken|confirmation tokens|COMMIT_TOKEN/);
    expect(readme).not.toMatch(/semantic search|vector search/i);

    expect(skill).toMatch(/candidate discovery/i);
    expect(skill).toMatch(/selectedRef/i);
    expect(skill).toMatch(/safe vault-relative/i);
    expect(skill).toMatch(/dryRun/i);
    expect(skill).toMatch(/obsidian_config/i);
    expect(skill).toMatch(/obsidian_destroy/i);
    expect(skill).toMatch(/recoverable move-to-trash/i);
    expect(skill).toMatch(/restore_note/i);
    expect(skill).toMatch(/trashPath/i);
    expect(skill).toMatch(/copy_note/i);
    expect(skill).toMatch(/byte-for-byte/i);
    expect(skill).toMatch(/workflow-neutral/i);
    expect(skill).toMatch(/Never use non-destroy Obsidian tools for full-note overwrite, permanent delete/i);
    expect(skill).toMatch(/Use `obsidian_destroy` only for explicit `delete_note`/i);
    expect(skill).not.toMatch(/confirmation tokens|commit-token/i);
  });

  it("uses one package name consistently without hardcoding the README version", () => {
    const readme = readText("README.md");
    const changelog = readText("CHANGELOG.md");
    const release = readText("RELEASE.md");
    const expectedInstall = `pi install npm:${packageJson.name}`;

    expect(packageJson.name).toBe("pi-obsidian-vault");
    expect(packageJson.version).toBe("0.2.3");
    for (const doc of [changelog, release]) {
      expect(doc).toContain(packageJson.name);
      expect(doc).toContain(packageJson.version);
    }
    expect(readme).toContain(packageJson.name);
    expect(readme).toContain(expectedInstall);
    expect(release).toContain(expectedInstall);
    expect(changelog).toContain("Initial public release");
    expect(readme).not.toContain("Current package version");
    expect(readme).not.toContain(packageJson.version);
  });

  it("covers package landing page sections and avoids unsafe positioning", () => {
    const readme = readText("README.md");
    const requiredSections = [
      "assets/pi-obsidian-vault-cover.png",
      "# Pi Obsidian Vault",
      "What it is",
      "Tools at a glance",
      "Quick start",
      "Configuration and vault resolution",
      "Agent workflow",
      "Examples",
      "Safety model",
      "Limitations and troubleshooting",
      "Security and issues",
    ];
    for (const section of requiredSections) expect(readme).toContain(section);

    expect(readme).toMatch(/Agent-safe Obsidian vault access for Pi/i);
    expect(readme).toMatch(/not an Obsidian community plugin/i);
    expect(readme).toMatch(/not.*desktop GUI|does not.*GUI/i);
    expect(readme).toMatch(/Permanent delete/i);
    expect(readme).toMatch(/automatic link rewriting/i);
    expect(readme).toMatch(/Shell execution/i);
    expect(readme).not.toMatch(/automatic vault organizer as a capability|community plugin UI/i);
  });

  it("documents the one-setting config model and softened redaction claim", () => {
    const readme = readText("README.md");
    const envExample = readText(".env.example");
    expect(readme).toContain("$HOME/.pi/agent/obsidian-vault.json");
    expect(readme).toContain("vaultPath");
    expect(readme).toContain("obsidian_config");
    expect(readme).toContain("/obsidian-vault set-vault");
    expect(readme).toContain("OBSIDIAN_VAULT_PATH");
    expect(readme).toMatch(/Obsidian Desktop auto-detect/i);
    expect(readme).toMatch(/not a complete retrieval\/CLI health check/i);
    expect(readme).toMatch(/designed and tested to redact|redact common sensitive/i);
    expect(envExample).toMatch(/Normal users do not need env vars/i);
    expect(envExample).toContain("OBSIDIAN_VAULT_PATH");
    expect(readme).not.toContain("OBSIDIAN_RETRIEVE_DEFAULT_BUDGET");
    expect(readme).not.toContain("OBSIDIAN_COMMIT_TOKEN");
  });

  it("documents security topics and reporting in README and SECURITY.md", () => {
    const readme = readText("README.md");
    const security = readText("SECURITY.md");
    for (const doc of [readme, security]) {
      expect(doc).toMatch(/safe.*vault-relative|vault-relative.*safe/i);
      expect(doc).toMatch(/human approval|dryRun/i);
      expect(doc).toMatch(/read-only tools/i);
      expect(doc).toMatch(/broad vault scans|broad vault dumps/i);
      expect(doc).toMatch(/permanent delete/i);
      expect(doc).toMatch(/overwrite/i);
      expect(doc).toMatch(/wildcard or bulk|recursive, wildcard, or bulk|recursive\/wildcard\/bulk/i);
      expect(doc).toMatch(/link rewriting/i);
      expect(doc).toMatch(/GUI|UI-open/i);
      expect(doc).toMatch(/redact/i);
      expect(doc).not.toMatch(/confirmation tokens|commit-token/i);
    }
    expect(security).toMatch(/Reporting security issues/i);
    expect(security).toMatch(/controlled CLI adapter/i);
    expect(security).toMatch(/temporary or disposable vaults/i);
  });

  it("includes concise safe examples for every public tool and command", () => {
    const readme = readText("README.md");
    const exampleTokens = [
      '"operation": "set_vault"',
      '"mode": "search"',
      '"mode": "graph"',
      '"mode": "context"',
      '"mode": "note"',
      '"mode": "relationships"',
      '"target": "proposed_content"',
      '"target": "existing_note"',
      '"tool": "obsidian_write"',
      '"operation": "create"',
      '"operation": "append"',
      '"operation": "create_folder"',
      '"operation": "replace_exact_text"',
      '"operation": "move_note"',
      '"operation": "trash_note"',
      '"operation": "restore_note"',
      '"operation": "copy_note"',
      '"operation": "delete_note"',
      '"operation": "delete_folder"',
      '"operation": "replace_note"',
      '"operation": "empty_trash"',
      '"title": "New Idea"',
      "/obsidian-vault",
    ];
    for (const token of exampleTokens) expect(readme).toContain(token);
    expect(readme).toContain("Supported top-level request fields");
    expect(readme).toContain("Valid `budget` values: `tiny`, `standard`, `expanded`.");
  });

  it("keeps packaged skill manifest and docs consistent", () => {
    expect(packageJson.pi?.extensions).toContain("./src/index.ts");
    expect(packageJson.pi?.skills).toContain("./skills/obsidian-research");
    expect(existsSync(new URL("../skills/obsidian-research/SKILL.md", import.meta.url))).toBe(true);

    const release = readText("RELEASE.md");
    expect(release).toContain("./skills/obsidian-research");
  });
});
