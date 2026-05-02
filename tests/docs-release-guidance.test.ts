import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readText = (relativePath: string): string => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const packageJson = JSON.parse(readText("package.json")) as {
  name: string;
  version: string;
  pi?: { extensions?: string[]; skills?: string[] };
};

const requiredConfigFields = [
  "vaultPath",
  "cliPath",
  "defaultRetrieveBudget",
  "defaultRelationshipBudget",
  "maxPreviewChars",
  "maxValidationIssues",
  "defaultTrashFolder",
  "commitTokensRequired",
  "commitTokenTtlSeconds",
  "commitTokenStrictMode",
  "writeDryRunValidationEnabled",
  "appendDryRunValidationEnabled",
];

const requiredEnvVars = [
  "OBSIDIAN_VAULT_PATH",
  "OBSIDIAN_CLI_PATH",
  "OBSIDIAN_RETRIEVE_DEFAULT_BUDGET",
  "OBSIDIAN_RELATIONSHIP_DEFAULT_BUDGET",
  "OBSIDIAN_MAX_PREVIEW_CHARS",
  "OBSIDIAN_VALIDATE_MAX_ISSUES",
  "OBSIDIAN_TRASH_FOLDER",
  "OBSIDIAN_COMMIT_TOKENS_REQUIRED",
  "OBSIDIAN_COMMIT_TOKEN_TTL_SECONDS",
  "OBSIDIAN_COMMIT_TOKEN_STRICT_MODE",
  "OBSIDIAN_WRITE_DRY_RUN_VALIDATION_ENABLED",
  "OBSIDIAN_APPEND_DRY_RUN_VALIDATION_ENABLED",
];

describe("release documentation and skill guidance", () => {
  it("documents the public surface, operations, workflow, dry-run model, limitations, recoverable trash, restore, and copy", () => {
    const readme = readText("README.md");
    const skill = readText("skills/obsidian-research/SKILL.md");

    for (const token of ["obsidian_retrieve", "obsidian_validate", "obsidian_plan", "obsidian_write", "obsidian_edit", "obsidian_manage", "/obsidian-vault"]) {
      expect(readme).toContain(token);
    }
    for (const operation of ["search", "context", "graph", "project", "relationships", "create", "append", "create_folder", "replace_section", "insert_under_heading", "update_frontmatter", "remove_frontmatter", "replace_exact_text", "move_note", "trash_note", "restore_note", "copy_note"]) {
      expect(readme).toContain(operation);
    }

    expect(readme).toMatch(/Recommended agent workflow/i);
    expect(readme).toMatch(/retrieve candidates/i);
    expect(readme).toMatch(/selected context/i);
    expect(readme).toMatch(/dryRun[^\n]+true/i);
    expect(readme).toMatch(/dryRun[^\n]+false/i);
    expect(readme).toMatch(/unsupported operations|intentionally does not do|intentionally unsupported/i);
    expect(readme).toMatch(/recoverable move-to-trash/i);
    expect(readme).toMatch(/not permanent deletion/i);
    expect(readme).toMatch(/restore_note/i);
    expect(readme).toMatch(/trashPath/i);
    expect(readme).toMatch(/TRASH_PATH_OUTSIDE_TRASH/);
    expect(readme).toMatch(/copy_note/i);
    expect(readme).toMatch(/byte-for-byte/i);
    expect(readme).toMatch(/SOURCE_NOT_FILE/);
    expect(readme).toMatch(/workflow-neutral/i);
    expect(readme).toMatch(/warning-severity advisory/i);
    expect(readme).toMatch(/write dry-run validation/i);
    expect(readme).toMatch(/obsidian_plan/i);
    expect(readme).toMatch(/never executes|never execute/i);
    expect(readme).toMatch(/commit tokens|confirmation tokens/i);
    expect(readme).toMatch(/no vault-wide backlink scan|no broad vault or backlink scan/i);

    expect(skill).toMatch(/candidate discovery/i);
    expect(skill).toMatch(/selectedRef/i);
    expect(skill).toMatch(/explicit safe vault-relative/i);
    expect(skill).toMatch(/dryRun/i);
    expect(skill).toMatch(/recoverable move-to-trash/i);
    expect(skill).toMatch(/restore_note/i);
    expect(skill).toMatch(/trashPath/i);
    expect(skill).toMatch(/copy_note/i);
    expect(skill).toMatch(/byte-for-byte/i);
    expect(skill).toMatch(/obsidian_validate/i);
    expect(skill).toMatch(/mode: "relationships"/i);
    expect(skill).toMatch(/obsidian_plan/i);
    expect(skill).toMatch(/workflow-neutral/i);
    expect(skill).toMatch(/warning-severity advisory/i);
    expect(skill).toMatch(/Never use any Obsidian tool for full-note overwrite, permanent delete/i);
  });

  it("uses one package name consistently across public release docs", () => {
    const readme = readText("README.md");
    const changelog = readText("CHANGELOG.md");
    const release = readText("RELEASE.md");
    const expectedInstall = `pi install npm:${packageJson.name}`;

    expect(packageJson.name).toBe("pi-obsidian-vault");
    expect(packageJson.version).toBe("0.1.1");
    for (const doc of [readme, changelog, release]) {
      expect(doc).toContain(packageJson.name);
      expect(doc).toContain(packageJson.version);
    }
    expect(readme).toContain(expectedInstall);
    expect(release).toContain(expectedInstall);
    expect(changelog).toContain("Initial public release");
  });

  it("covers package landing page sections and avoids unsafe positioning", () => {
    const readme = readText("README.md");
    const requiredSections = [
      "assets/pi-obsidian-vault-cover.png",
      "# Pi Obsidian Vault",
      "What it is",
      "Why it exists",
      "What it intentionally does not do",
      "Install",
      "Configuration",
      "Environment variable example",
      "Quick start",
      "Tool overview",
      "Examples",
      "Commit-token workflow",
      "Security model summary",
      "Limitations",
      "Troubleshooting",
      "Release/version info",
      "Contributing and issues",
    ];
    for (const section of requiredSections) {
      expect(readme).toContain(section);
    }

    expect(readme).toMatch(/Agent-safe Obsidian vault access for Pi/i);
    expect(readme).toMatch(/not an Obsidian community plugin/i);
    expect(readme).toMatch(/not.*desktop GUI|does not.*GUI/i);
    expect(readme).toMatch(/does \*\*not\*\* provide or enable/i);
    expect(readme).toMatch(/Broad vault dumps/i);
    expect(readme).toMatch(/Permanent delete/i);
    expect(readme).toMatch(/Automatic link rewriting/i);
    expect(readme).toMatch(/Shell execution/i);
    expect(readme).toMatch(/Configuration cannot enable those powers/i);
  });

  it("documents canonical config fields, environment variables, safe fallback, token config, and redaction", () => {
    const readme = readText("README.md");
    const envExample = readText(".env.example");
    for (const field of requiredConfigFields) {
      expect(readme).toContain(field);
    }
    for (const envVar of requiredEnvVars) {
      expect(readme).toContain(envVar);
      expect(envExample).toContain(envVar);
    }
    expect(readme).toContain("~/.pi/agent/obsidian-vault.json");
    expect(readme).toMatch(/Invalid values fall back or warn/i);
    expect(readme).toMatch(/Unsafe config values do not authorize unsafe operations/i);
    expect(readme).toMatch(/redacted from tool and status output/i);
    expect(readme).toMatch(/commitTokenStrictMode/i);
  });

  it("documents security topics and reporting in README and SECURITY.md", () => {
    const readme = readText("README.md");
    const security = readText("SECURITY.md");
    for (const doc of [readme, security]) {
      expect(doc).toMatch(/explicit.*vault-relative paths|explicit-path-only/i);
      expect(doc).toMatch(/dry-run-first|dry-run previews|dryRun/i);
      expect(doc).toMatch(/confirmation tokens?|commit-token/i);
      expect(doc).toMatch(/read-only tools/i);
      expect(doc).toMatch(/broad vault scans|broad vault dumps/i);
      expect(doc).toMatch(/permanent delete/i);
      expect(doc).toMatch(/overwrite/i);
      expect(doc).toMatch(/recursive, wildcard, or bulk|recursive\/wildcard\/bulk/i);
      expect(doc).toMatch(/link rewriting/i);
      expect(doc).toMatch(/GUI|UI-open/i);
      expect(doc).toMatch(/redact/i);
    }
    expect(security).toMatch(/Reporting security issues/i);
    expect(security).toMatch(/controlled CLI adapter/i);
    expect(security).toMatch(/temporary or disposable vaults/i);
  });

  it("includes safe examples for every public tool and command", () => {
    const readme = readText("README.md");
    const exampleTokens = [
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
      '"operation": "replace_exact_text"',
      '"operation": "move_note"',
      '"operation": "trash_note"',
      '"operation": "restore_note"',
      '"operation": "copy_note"',
      '"confirmationToken": "<token returned by the matching dry-run>"',
      "/obsidian-vault",
    ];
    for (const token of exampleTokens) {
      expect(readme).toContain(token);
    }
    expect(readme).toContain("Supported top-level request fields");
    expect(readme).toContain("Valid `budget` values: `tiny`, `standard`, `expanded`.");
  });

  it("documents changelog and release checklist completeness", () => {
    const changelog = readText("CHANGELOG.md");
    const release = readText("RELEASE.md");
    for (const token of ["obsidian_retrieve", "obsidian_validate", "obsidian_plan", "obsidian_write", "obsidian_edit", "obsidian_manage", "commit-token", "Config polish", "Known limitations"]) {
      expect(changelog).toMatch(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    }
    for (const command of ["npm run check", "npm pack --dry-run", "npm test -- tool-surface", "npm test -- status-capabilities", "npm test -- no-shell-network", "npm test -- side-effect-refusal", "npm test -- redaction-regression", "npm test -- validation-tool", "npm test -- validation-path-safety", "npm test -- plan-preview", "npm test -- plan-request-validation", "npm test -- plan-path-safety", "npm test -- plan-conflicts", "npm test -- plan-output-ordering", "npm test -- plan-no-mutation"]) {
      expect(release).toContain(command);
    }
    expect(release).toContain("Intentionally excluded from the npm package");
    expect(release).toContain("Exact Pi install command: `pi install npm:pi-obsidian-vault`");
    expect(release).toContain("Exact npm publish command: `npm publish`");
  });

  it("keeps packaged skill manifest and docs consistent", () => {
    expect(packageJson.pi?.extensions).toContain("./src/index.ts");
    expect(packageJson.pi?.skills).toContain("./skills/obsidian-research");
    expect(existsSync(new URL("../skills/obsidian-research/SKILL.md", import.meta.url))).toBe(true);

    const release = readText("RELEASE.md");
    expect(release).toContain("./skills/obsidian-research");
  });
});
