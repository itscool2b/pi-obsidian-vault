<p align="center">
  <img src="https://raw.githubusercontent.com/itscool2b/pi-obsidian-vault/main/assets/pi-obsidian-vault-cover.png" alt="Pi Obsidian Vault thumbnail: Pi mascot reaching into an Obsidian vault" width="100%" />
</p>

# Pi Obsidian Vault

[![npm version](https://img.shields.io/npm/v/pi-obsidian-vault.svg)](https://www.npmjs.com/package/pi-obsidian-vault)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/Pi-package-purple.svg)](https://github.com/itscool2b/pi-obsidian-vault)

**Dead-simple, agent-safe Obsidian vault access for Pi.**

```bash
pi install npm:pi-obsidian-vault
```

One install. One remembered vault path. Natural-language retrieval, validation, planning, writing, editing, note management, and explicit destructive actions with human approval built in.

`pi-obsidian-vault` is a Pi coding-agent extension. It is not an Obsidian community plugin, desktop GUI, pane, or automatic vault organizer.

## What it is

This package registers these Pi tools:

- `obsidian_config` — remember, forget, or inspect the single vault path setting.
- `obsidian_retrieve` — candidate-first retrieval, selected context, graph/project summaries, explicit note inspection, and bounded explicit-note relationships.
- `obsidian_validate` — read-only, workflow-neutral Markdown validation.
- `obsidian_plan` — read-only non-destructive operation plan previews that never execute.
- `obsidian_write` — Markdown `create`, `append`, and `create_folder`. `create` can infer a safe path from `title` / content.
- `obsidian_edit` — structured edits: `replace_section`, `insert_under_heading`, `update_frontmatter`, `remove_frontmatter`, `replace_exact_text`.
- `obsidian_manage` — single-note `move_note`, recoverable `trash_note`, explicit `restore_note`, and byte-for-byte `copy_note`.
- `obsidian_destroy` — explicit destructive operations: `delete_note`, `delete_folder`, `replace_note`, and `empty_trash`.
- `/obsidian-vault` — simple redacted status plus session auto-write/auto-destroy controls.

## Why it exists

Pi works best when you can just ask for the outcome. The extension tries to auto-detect your local Obsidian Desktop vault. If that fails, tell the agent your vault folder path once and it can remember it.

Normal non-destructive mutation flow:

```text
agent calls tool → extension previews internally → human chooses Yes / No / Auto-write this session → commit only if approved
```

Destructive flow is separate and deliberately loud:

```text
agent calls obsidian_destroy → extension previews internally → human chooses Yes, destroy / No / Auto-destroy this session → destroy only if approved
```

No dry-run/token/retry dance. Hard rails still block unsafe paths, accidental overwrites, wildcard/bulk/inferred destructive operations, shell/network commands, and local path leaks. Permanent destructive actions live in the separate `obsidian_destroy` tool and require separate destructive approval.

## Quick start

1. Install the package.
2. Open your vault in Obsidian Desktop once.
3. Restart or `/reload` Pi.
4. Talk naturally:

```text
make a note about the automatic vault detection idea
```

If auto-detection fails, say something like:

```text
use this Obsidian vault: /home/me/Documents/My Vault
```

The agent can call `obsidian_config` with `operation: "set_vault"`, or you can run:

```text
/obsidian-vault set-vault /home/me/Documents/My Vault
```

## Configuration

There is only one normal persistent setting:

```json
{ "vaultPath": "/absolute/path/to/your/vault" }
```

You normally do not edit that file. Let the agent remember it with `obsidian_config`, or use the slash command above.

Resolution order:

1. remembered `vaultPath`
2. Obsidian Desktop auto-detection
3. setup-needed response asking for the vault folder path

Everything else is hardcoded sane defaults:

- retrieve budget: `expanded`
- relationship budget: `expanded`
- preview cap: `100000` characters
- validation issue cap: `50`
- trash folder: `_Trash`

## `/obsidian-vault`

Normal status is intentionally small:

```text
Obsidian Vault: ready
Vault: auto-detected | remembered | missing
Mutations: approval required | auto-write this session
Destructive mutations: destructive approval required | auto-destroy this session
Auto-write this session: disabled
Auto-destroy this session: disabled
Trash folder: _Trash
```

Session commands:

```text
/obsidian-vault auto-write status
/obsidian-vault auto-write on
/obsidian-vault auto-write off
/obsidian-vault auto-destroy status
/obsidian-vault auto-destroy on
/obsidian-vault auto-destroy off
/obsidian-vault set-vault <path>
/obsidian-vault forget-vault
```

## Tool overview

| Tool or command | Purpose | Safety posture |
| --- | --- | --- |
| `obsidian_config` | Remember/forget/status for the one vault path setting | No vault content mutation |
| `obsidian_retrieve` | Search, context, graph, project, explicit note inspection, explicit relationships | Read-only, candidate-first, budgeted, no broad dumps |
| `obsidian_validate` | Validate one existing note or proposed Markdown content | Read-only, workflow-neutral, advisory |
| `obsidian_plan` | Preview bounded explicit non-destructive operations | Read-only; never executes, commits, stages, batches, or writes files |
| `obsidian_write` | Create Markdown notes, append Markdown, create folders | Human approval or session auto-write before commit; no overwrite |
| `obsidian_edit` | Structured edits to existing notes | Human approval or session auto-write before commit; exact structured targets |
| `obsidian_manage` | Single-note move, recoverable move-to-trash, restore, copy | Human approval or session auto-write before commit; not permanent deletion; no link rewriting |
| `obsidian_destroy` | Permanent note delete, recursive folder delete, full-note replace, empty trash | Separate destructive approval or session auto-destroy; no inferred targets |
| `/obsidian-vault` | Status and session controls | Redacted, simple |

Supported top-level request fields for `obsidian_retrieve` are exactly `query`, `mode`, `path`, `selected`, `scope`, `budget`, `maxCandidates`, `maxRelated`, `includeBacklinks`, `includeOutgoing`, `includeSections`, and `explain`.

Valid `budget` values: `tiny`, `standard`, `expanded`.

## Recommended agent workflow

1. Use `obsidian_retrieve` for candidate discovery with `mode: "search"`, `mode: "graph"`, or bounded `mode: "project"`.
2. Read `agentGuidance`; when it recommends selected context, call `obsidian_retrieve` with `mode: "context"` and only exact returned `selectedRef` paths.
3. Use `mode: "note"` only with one explicit safe vault-relative Markdown path.
4. Use `mode: "relationships"` only for one explicit safe Markdown path. There is no vault-wide backlink scan or broad vault/backlink scan.
5. Use `obsidian_validate` for read-only Markdown checks.
6. Use `obsidian_plan` for read-only non-destructive previews. It never executes or commits; use `obsidian_destroy` `dryRun: true` for destructive previews.
7. For normal mutation requests, call the right mutation tool and omit `dryRun`; the extension previews internally, asks the human, then commits if approved.
8. Use `obsidian_destroy` only for explicit permanent deletion, recursive folder deletion, full-note replacement, or emptying trash. Auto-write does not apply; destructive approval is separate.
9. Use `dryRun: true` only when the user explicitly asks to preview/check/plan without changing the vault.
10. If setup is missing, ask for the vault folder path and call `obsidian_config` `set_vault`.

## Examples

### `obsidian_config`

```json
{ "operation": "set_vault", "vaultPath": "/home/me/Documents/My Vault" }
```

```json
{ "operation": "forget_vault" }
```

```json
{ "operation": "status" }
```

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

Validation is workflow-neutral. Missing frontmatter, tags, templates, PARA, Zettelkasten, daily-note structure, or project-note structure are not errors. Suspicious path-like strings inside content are warning-severity advisory issues.

```json
{
  "target": "proposed_content",
  "content": "# Roadmap\n\nSee [Plan](Plan.md).",
  "expectedPath": "Projects/Roadmap.md"
}
```

### `obsidian_validate` existing note

```json
{ "target": "existing_note", "path": "Projects/Roadmap.md", "budget": "tiny" }
```

### `obsidian_plan`

```json
{
  "operations": [
    { "tool": "obsidian_write", "operation": "create", "path": "Projects/New Idea.md", "content": "# New Idea\n" },
    { "tool": "obsidian_edit", "operation": "replace_exact_text", "path": "Projects/Roadmap.md", "oldText": "old", "newText": "new" }
  ]
}
```

### `obsidian_write` create with inferred path

```json
{ "operation": "create", "title": "New Idea", "folderHint": "Projects", "content": "# New Idea\n\nDetails." }
```

### `obsidian_write` append

```json
{ "operation": "append", "path": "Projects/Roadmap.md", "content": "\n## Update\n\nNew notes." }
```

### `obsidian_edit` exact text

```json
{ "operation": "replace_exact_text", "path": "Projects/Roadmap.md", "oldText": "Old phrase", "newText": "New phrase" }
```

### `obsidian_manage` move/trash/restore/copy

```json
{ "operation": "move_note", "fromPath": "Projects/Roadmap.md", "toPath": "Archive/Roadmap.md" }
```

```json
{ "operation": "trash_note", "path": "Archive/Roadmap.md" }
```

```json
{ "operation": "restore_note", "trashPath": "_Trash/Roadmap.md", "toPath": "Projects/Roadmap.md" }
```

```json
{ "operation": "copy_note", "fromPath": "Projects/Roadmap.md", "toPath": "Archive/Roadmap Copy.md" }
```

### `obsidian_destroy` destructive operations

```json
{ "operation": "delete_note", "path": "Archive/Old.md" }
```

```json
{ "operation": "delete_folder", "path": "Archive/Old Project" }
```

```json
{ "operation": "replace_note", "path": "Projects/Roadmap.md", "content": "# Replaced Roadmap\n" }
```

```json
{ "operation": "empty_trash" }
```

## Human approval workflow

Mutation tools (`obsidian_write`, `obsidian_edit`, `obsidian_manage`, `obsidian_destroy`) compute a preview before committing. Non-destructive mutation dialogs offer:

```text
Yes
No
Auto-write this session
```

`Auto-write this session` approves the current non-destructive change and remembers the choice only in memory for the current Pi session. Future non-destructive mutations still run internal preview and safety checks, but skip prompts until the session resets or you run `/obsidian-vault auto-write off`.

`dryRun: true` is always preview-only, even when session auto-write or auto-destroy is enabled.

`obsidian_destroy` uses separate destructive choices: `Yes, destroy`, `No`, and `Auto-destroy this session`. Auto-write never authorizes destructive operations. Without an interactive approval UI, destructive calls return previews only unless auto-destroy was already enabled in the same Pi session.

## Security model summary

Read-only tools (`obsidian_retrieve`, `obsidian_validate`, `obsidian_plan`) do not mutate the vault.

Hard rails refuse:

- unsafe vault-relative paths, absolute targets, traversal, hidden paths, and `.obsidian` paths
- accidental overwrites, suffixing, auto-renaming, inferred permanent delete, and destructive folder operations outside `obsidian_destroy`
- wildcard or bulk operations; recursive deletion only for one explicit `obsidian_destroy delete_folder` target after destructive approval
- broad vault scans/dumps and broad backlink scans
- link rewriting
- GUI/UI-open behavior, shell execution, network calls, or arbitrary CLI commands

Outputs redact vault roots, absolute local paths, CLI paths, lock keys, shell/network details, and arbitrary local filesystem details. Vault-relative paths such as `Projects/Roadmap.md` are allowed.

Common refusal/error codes include `TRASH_PATH_OUTSIDE_TRASH`, `SOURCE_NOT_FILE`, `TARGET_EXISTS`, and `UNSAFE_PATH`.

## Limitations

Committed smoke tests use temporary or disposable vaults only. Real-vault checks are opt-in/manual only.

- Retrieval depends on the controlled Obsidian CLI adapter.
- Relationship/backlink data degrades when the CLI or metadata is unavailable.
- Mutation tools operate on explicit targets only; no fuzzy note picking for edits/moves.
- `copy_note` is byte-for-byte and does not rewrite links.
- `trash_note` is recoverable move-to-trash, not permanent deletion. Use `obsidian_destroy` only when permanent destruction is explicitly requested.

## Troubleshooting

### Vault not found

Open the vault in Obsidian Desktop once, then `/reload` Pi. Or tell the agent the vault folder path so it can call `obsidian_config` `set_vault`.

### I enabled auto-write and want prompts again

```text
/obsidian-vault auto-write off
```

### I enabled auto-destroy and want destructive prompts again

```text
/obsidian-vault auto-destroy off
```

### I want to use a different vault

```text
/obsidian-vault set-vault /path/to/other/vault
```

or ask the agent naturally.

## Release/version info

Current package version: `pi-obsidian-vault` `0.2.0`.

Install command:

```bash
pi install npm:pi-obsidian-vault
```

## Contributing and issues

Please report security-sensitive issues using the guidance in [SECURITY.md](./SECURITY.md). Do not include private vault contents, secrets, or absolute local paths in public issues.
