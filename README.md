# Pi Obsidian Vault

**Agent-safe Obsidian vault access for Pi.** Retrieve, inspect, validate, plan, and carefully mutate Markdown notes without broad vault dumps or unsafe commits.

`pi-obsidian-vault` is a Pi coding-agent extension. This is not an Obsidian community plugin. It is **not** a desktop GUI, pane, or automatic vault organizer.

## What it is

This package registers a small, explicit Pi tool surface for Obsidian vault work:

- `obsidian_retrieve` for candidate-first retrieval, selected context, graph/project summaries, explicit note inspection, and bounded explicit-note relationships.
- `obsidian_validate` for read-only, workflow-neutral Markdown validation.
- `obsidian_plan` for read-only operation plan previews that never execute.
- `obsidian_write` for explicit safe Markdown create/append and explicit safe `create_folder` folder creation.
- `obsidian_edit` for dry-run-first structured edits to existing Markdown notes.
- `obsidian_manage` for dry-run-first single-note move, recoverable trash, restore, and byte-for-byte copy.
- `/obsidian-vault` for redacted status and capability output.

## Why it exists

Agents need enough vault context to help with notes, but broad vault access and inferred mutations are risky. This extension keeps Obsidian access bounded: discovery is candidate-first, local mutations require explicit safe vault-relative paths, mutations preview before commit, risky commits can require confirmation tokens, and outputs redact local filesystem details.

## What it intentionally does not do

This package does **not** provide or enable:

- Obsidian community plugin UI, GUI panes, UI-open commands, or desktop automation.
- Broad vault dumps, broad folder dumps, broad vault listing, broad filesystem discovery, or recursive graph crawling.
- Batch execution, transaction commits, staged commits, broad backlink mutation, templates, or automatic vault organization.
- Permanent delete, destructive folder operations, overwrite, suffixing, auto-renaming, destination inference, or auto path generation.
- Automatic link rewriting.
- Recursive, wildcard, or bulk operations, including folder or non-Markdown move/trash/restore/copy operations.
- Shell execution, network calls, or arbitrary CLI commands outside the controlled retrieval adapter.

Configuration cannot enable those powers.

## Install

```bash
pi install npm:pi-obsidian-vault
```

If Pi is already running, reload or restart Pi after installation so the package is discovered. In the interactive TUI, use `/reload` when available; otherwise quit and start Pi again.

## Configuration

Supported configuration sources:

1. `~/.pi/agent/obsidian-vault.json`
2. Environment variables

Local write/edit/manage operations require `vaultPath` / `OBSIDIAN_VAULT_PATH`. Retrieval can also use the configured Obsidian CLI. Tool requests use vault-relative paths such as `Projects/Roadmap.md`; only the configuration value that identifies your local vault root is an absolute local path.

### Config file example

Create `~/.pi/agent/obsidian-vault.json`:

```json
{
  "vaultPath": "/absolute/path/to/your/vault",
  "cliPath": "obsidian-cli",
  "defaultRetrieveBudget": "standard",
  "defaultRelationshipBudget": "standard",
  "maxPreviewChars": 4000,
  "maxValidationIssues": 50,
  "defaultTrashFolder": "_Trash",
  "commitTokensRequired": true,
  "commitTokenTtlSeconds": 300,
  "commitTokenStrictMode": false,
  "writeDryRunValidationEnabled": true,
  "appendDryRunValidationEnabled": true
}
```

Important fields:

- `vaultPath`: local Obsidian vault folder. Required for write/edit/manage and used as the retrieval CLI working directory when no vault name/id target is set.
- `cliPath`: Obsidian CLI binary, usually `obsidian-cli`. If `obsidian` opens the desktop app on your system, use `obsidian-cli`.
- `defaultRetrieveBudget`: default `obsidian_retrieve` budget for non-relationship modes: `tiny`, `standard`, or `expanded`.
- `defaultRelationshipBudget`: default budget for `obsidian_retrieve` `mode: "relationships"`.
- `maxPreviewChars`: bounded write/edit preview helper size; it does not broaden retrieval output.
- `maxValidationIssues`: validation issue cap.
- `defaultTrashFolder`: safe vault-relative trash folder for `trash_note` / `restore_note`, default `_Trash`.
- `commitTokensRequired`: require confirmation tokens for risky commits by policy.
- `commitTokenTtlSeconds`: token lifetime in seconds.
- `commitTokenStrictMode`: require tokens for all existing committed mutation operations when enabled.
- `writeDryRunValidationEnabled`: include advisory validation metadata on write create dry-runs when enabled.
- `appendDryRunValidationEnabled`: include advisory validation metadata on append dry-runs when enabled.

Invalid values fall back or warn according to existing behavior. Unsafe config values do not authorize unsafe operations, bypass path safety, disable redaction, enable broad scans, enable overwrite, enable link rewriting, or enable shell/network/UI behavior.

### Environment variable example

```env
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault
OBSIDIAN_CLI_PATH=obsidian-cli
OBSIDIAN_RETRIEVE_DEFAULT_BUDGET=standard
OBSIDIAN_RELATIONSHIP_DEFAULT_BUDGET=standard
OBSIDIAN_MAX_PREVIEW_CHARS=4000
OBSIDIAN_VALIDATE_MAX_ISSUES=50
OBSIDIAN_TRASH_FOLDER=_Trash
OBSIDIAN_COMMIT_TOKENS_REQUIRED=true
OBSIDIAN_COMMIT_TOKEN_TTL_SECONDS=300
OBSIDIAN_COMMIT_TOKEN_STRICT_MODE=false
OBSIDIAN_WRITE_DRY_RUN_VALIDATION_ENABLED=true
OBSIDIAN_APPEND_DRY_RUN_VALIDATION_ENABLED=true
```

Advanced retrieval-only vault targeting is also supported through `OBSIDIAN_VAULT_NAME` or `OBSIDIAN_VAULT_ID`, but local mutations still require a local `vaultPath`.

Vault roots, absolute local paths, CLI paths, token internals, lock keys, shell details, network details, and arbitrary local filesystem details are redacted from tool and status output.

## Quick start

1. Install the package.
2. Configure `OBSIDIAN_VAULT_PATH` or `~/.pi/agent/obsidian-vault.json`.
3. Restart or `/reload` Pi.
4. Run:

```text
/obsidian-vault
```

The status command is side-effect-free. It reports capability availability and redacted config posture without opening Obsidian or exposing your vault root.

5. Start with retrieval before any mutation:

```json
{ "query": "project roadmap", "mode": "search", "budget": "standard" }
```

## Tool overview

| Tool or command | Purpose | Safety posture |
| --- | --- | --- |
| `obsidian_retrieve` | Search, context, graph, project, explicit note inspection, explicit relationships | Read-only, candidate-first, budgeted, no broad dumps |
| `obsidian_validate` | Validate one existing note or proposed Markdown content | Read-only, workflow-neutral, advisory |
| `obsidian_plan` | Preview a bounded sequence of existing public operations | Read-only; never executes, commits, stages, batches, or creates tokens |
| `obsidian_write` | Create Markdown notes, append Markdown, create explicit folders | Explicit paths, dry-run default, no overwrite |
| `obsidian_edit` | Structured edits to existing notes | Explicit paths, dry-run default, token-required for risky edits by default |
| `obsidian_manage` | Single-note move, recoverable trash, restore, copy | Explicit paths, dry-run default, token-required by default, no link rewriting |
| `/obsidian-vault` | Status output | Redacted, side-effect-free |

Supported top-level request fields for `obsidian_retrieve` are exactly `query`, `mode`, `path`, `selected`, `scope`, `budget`, `maxCandidates`, `maxRelated`, `includeBacklinks`, `includeOutgoing`, `includeSections`, and `explain`.

Valid `budget` values: `tiny`, `standard`, `expanded`.

## Recommended agent workflow

1. Use `obsidian_retrieve` to retrieve candidates with `mode: "search"`, `mode: "graph"`, or bounded `mode: "project"`.
2. Read `agentGuidance`; when it recommends selected context, call `obsidian_retrieve` with `mode: "context"` and only the exact returned `selectedRef` paths.
3. Use `mode: "note"` only when the user provides one explicit safe vault-relative Markdown path.
4. Use `mode: "relationships"` only for one explicit safe Markdown path. Relationship retrieval performs no vault-wide backlink scan and no broad vault or backlink scan; backlinks degrade safely when unavailable.
5. Use `obsidian_validate` for read-only Markdown checks before proposing or committing content.
6. Use `obsidian_plan` for read-only operation previews. It never executes or commits.
7. Use mutation tools only with explicit safe vault-relative paths supplied or confirmed by the user.
8. Preview mutations first with omitted `dryRun` or `dryRun: true`.
9. Commit only after confirmation with `dryRun: false`; when a preview returns `confirmationToken`, repeat the exact request with that token before it expires.

## Examples

### `obsidian_retrieve` search

```json
{ "query": "project roadmap", "mode": "search", "budget": "standard" }
```

### `obsidian_retrieve` graph

```json
{ "query": "Project Roadmap connections", "mode": "graph", "budget": "expanded" }
```

### `obsidian_retrieve` selected context

```json
{
  "mode": "context",
  "query": "implementation details",
  "selected": [{ "path": "Projects/Roadmap.md", "title": "Roadmap" }],
  "budget": "standard"
}
```

### `obsidian_retrieve` explicit note inspection

```json
{ "mode": "note", "path": "Projects/Roadmap.md", "budget": "tiny" }
```

### `obsidian_retrieve` explicit relationships

```json
{ "mode": "relationships", "path": "Projects/Roadmap.md", "budget": "standard", "maxRelated": 10, "includeBacklinks": true }
```

### `obsidian_validate` proposed content

Validation is workflow-neutral: missing frontmatter, tags, templates, PARA, Zettelkasten, daily-note structure, or project-note structure are not errors. Suspicious path-like strings inside content are warning-severity advisory issues.

```json
{
  "target": "proposed_content",
  "content": "# Roadmap\n\nSee [Plan](Plan.md).",
  "expectedPath": "Projects/Roadmap.md",
  "budget": "tiny"
}
```

### `obsidian_validate` existing note

```json
{ "target": "existing_note", "path": "Projects/Roadmap.md", "budget": "standard" }
```

### `obsidian_plan` preview

```json
{
  "operations": [
    { "id": "create", "tool": "obsidian_write", "operation": "create", "path": "Projects/New Idea.md", "content": "# New Idea\n" },
    { "id": "validate", "tool": "obsidian_validate", "operation": "proposed_content", "content": "# New Idea\n", "expectedPath": "Projects/New Idea.md" }
  ],
  "budget": "standard"
}
```

If a planned entry contains `dryRun:false`, `obsidian_plan` warns and ignores it; the plan remains non-mutating.

### `obsidian_write` create dry-run

Write dry-run validation may include advisory validation metadata for supplied content. Warning/info issues do not block commits.

```json
{ "operation": "create", "path": "Projects/New Idea.md", "content": "# New Idea\n", "dryRun": true }
```

### `obsidian_write` append dry-run

```json
{ "operation": "append", "path": "Projects/New Idea.md", "content": "\n## Next\nReview safely.", "dryRun": true }
```

`create` never overwrites existing notes. `append` never creates missing notes.

### `obsidian_edit` dry-run and token commit

Preview first:

```json
{
  "operation": "replace_exact_text",
  "path": "Projects/New Idea.md",
  "oldText": "Review safely.",
  "newText": "Review with the team.",
  "dryRun": true
}
```

Commit only with the confirmation token returned by that matching dry-run:

```json
{
  "operation": "replace_exact_text",
  "path": "Projects/New Idea.md",
  "oldText": "Review safely.",
  "newText": "Review with the team.",
  "dryRun": false,
  "confirmationToken": "<token returned by the matching dry-run>"
}
```

Section edits include `replace_section` and `insert_under_heading`; frontmatter edits include `update_frontmatter` and `remove_frontmatter`. Exact-text edits match one literal span only. Duplicate matches are ambiguous; missing text is not found. `obsidian_edit` never creates notes or performs full-note overwrite.

### `obsidian_manage` dry-run and token commit

Preview a move:

```json
{ "operation": "move_note", "fromPath": "Projects/New Idea.md", "toPath": "Archive/New Idea.md", "dryRun": true }
```

Commit only with the confirmation token returned by that matching dry-run:

```json
{
  "operation": "move_note",
  "fromPath": "Projects/New Idea.md",
  "toPath": "Archive/New Idea.md",
  "dryRun": false,
  "confirmationToken": "<token returned by the matching dry-run>"
}
```

`obsidian_manage` also supports:

```json
{ "operation": "trash_note", "path": "Projects/New Idea.md", "trashFolder": "_Trash", "dryRun": true }
```

This is recoverable move-to-trash behavior, not permanent deletion.

```json
{ "operation": "restore_note", "trashPath": "_Trash/New Idea.md", "toPath": "Projects/New Idea.md", "dryRun": true }
```

`restore_note` refuses paths outside the selected trash folder, including `TRASH_PATH_OUTSIDE_TRASH` cases.

```json
{ "operation": "copy_note", "fromPath": "Projects/New Idea.md", "toPath": "Archive/New Idea Copy.md", "dryRun": true }
```

`copy_note` copies one regular Markdown note byte-for-byte and preserves the source. Deterministic copy errors include `SOURCE_NOT_FILE` when a source is not one regular file.

### `/obsidian-vault` status

```text
/obsidian-vault
```

Use status after install/config changes. It reports retrieve/write/edit/manage/plan/token/config posture as available, unavailable, or degraded without exposing local vault roots.

## Commit-token workflow

Confirmation tokens are a safety gate for risky commits. Dry-runs never require a token. When policy requires a token, a successful dry-run returns a bounded `confirmationToken`; the committed request must repeat the same normalized operation with `dryRun:false` and that exact token.

Tokens are process-local confirmations, not stable credentials. They are not one-time-use in this release, revocation lists are not implemented, and tokens expire by TTL or after extension process restart. Missing, malformed, expired, mismatched, unsupported-version, unavailable, unverifiable, or revoked-if-ever-encountered token states fail closed before mutation.

Default token-required operations include `obsidian_edit` `replace_section`, `obsidian_edit` `replace_exact_text`, and every `obsidian_manage` operation. Strict token mode can require tokens for all existing committed write/edit/manage mutations without adding new mutation powers.

## Security model summary

- Local mutations require explicit safe vault-relative paths.
- Mutations default to dry-run previews.
- Risky commits can require matching confirmation tokens.
- Read-only tools (`obsidian_retrieve`, `obsidian_validate`, `obsidian_plan`) do not mutate.
- Outputs are bounded and redacted.
- There is no permanent delete, overwrite, broad scan, link rewriting, batch execution, transaction commit, UI-open command, or arbitrary shell/network/CLI behavior.

See [SECURITY.md](./SECURITY.md) for the full security model and reporting guidance.

## Limitations

- The package operates inside Pi and uses Pi tools; it is not installed into Obsidian as a community plugin.
- Relationship retrieval requires one explicit note path for `mode: "relationships"`; broad relationship maps and recursive crawling are intentionally unsupported.
- Backlink information degrades safely when the configured retrieval backend cannot provide targeted metadata.
- Local write/edit/manage requires a configured local `vaultPath`.
- Commit tokens are process-local and expire; they are not a long-lived approval mechanism.
- Real-vault evaluation is opt-in/manual only. Committed smoke tests should use temporary or disposable vaults and preserve no-broad-scan guarantees.

## Troubleshooting

### Pi does not see the package

Run `pi install npm:pi-obsidian-vault`, then `/reload` or restart Pi. Confirm `/obsidian-vault` appears as a command.

### `/obsidian-vault` says the vault path is missing

Set `OBSIDIAN_VAULT_PATH` or create `~/.pi/agent/obsidian-vault.json` with `vaultPath`.

### Retrieval is unavailable

Confirm `OBSIDIAN_CLI_PATH` or `cliPath` points to an Obsidian CLI binary. Prefer `obsidian-cli` if `obsidian` opens the desktop app.

### Writes, edits, or manage operations are unavailable

Set a local `vaultPath`. Vault name/id targets are retrieval-only for safe local mutations.

### A commit is refused because a token is missing or invalid

Repeat the matching dry-run, review the preview, and commit the same request with the returned `confirmationToken` before it expires. Do not reuse tokens across different operations, paths, content, headings, or later processes.

### Config warnings appear

Invalid config falls back or warns safely. Unsafe config values do not enable unsafe behavior.

### Status output hides paths

This is intentional. Vault roots and absolute local paths are redacted from tool and status output.

## Release/version info

Current public release: `pi-obsidian-vault` `0.1.0`.

Install command:

```bash
pi install npm:pi-obsidian-vault
```

Publish command for maintainers after final verification:

```bash
npm publish
```

See [CHANGELOG.md](./CHANGELOG.md) and [RELEASE.md](./RELEASE.md) for release notes and the publish checklist.

## Contributing and issues

Source and issues: <https://github.com/itscool2b/pi-obsidian-vault>

Please report security-sensitive issues using the guidance in [SECURITY.md](./SECURITY.md). Do not include private vault contents, secrets, confirmation tokens, or absolute local paths in public issues.
