<p align="center">
  <img src="https://raw.githubusercontent.com/itscool2b/pi-obsidian-vault/main/assets/pi-obsidian-vault-cover.png" alt="Pi Obsidian Vault thumbnail: Pi mascot reaching into an Obsidian vault" width="100%" />
</p>

# Pi Obsidian Vault

[![npm version](https://img.shields.io/npm/v/pi-obsidian-vault.svg)](https://www.npmjs.com/package/pi-obsidian-vault)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/Pi-package-purple.svg)](https://github.com/itscool2b/pi-obsidian-vault)

**Dead-simple, agent-safe Obsidian vault access for Pi.**

**Prerequisite:** In Obsidian Desktop, go to Settings → General → Advanced → CLI (Command line interface), enable it, then click **Register for PATH**.

```bash
pi install npm:pi-obsidian-vault
```

`pi-obsidian-vault` gives Pi agents safe, bounded access to one local Obsidian vault: retrieve context first, then make explicit note changes only when requested.

**Auto-detect comes first.** Open your vault in Obsidian Desktop once, reload Pi, and ask. Pi can also auto-open the configured/detected vault when a vault-touching tool needs it. Manual `/obsidian-vault set-vault` is only the fallback when auto-detect cannot find the vault.

## Quick start

Auto-detect is the normal path:

1. Install the package.
2. Open your vault in Obsidian Desktop once.
3. Restart Pi or run `/reload`.
4. Ask naturally.

```text
find my notes about project roadmap
```

```text
make a note about the automatic vault detection idea
```

```text
append today's decision to Projects/Roadmap.md
```

If Pi cannot see your vault, it asks for the vault folder path instead of guessing. You can also set it directly:

```text
/obsidian-vault set-vault /home/me/Documents/My Vault
```

## What it is

This is a Pi coding-agent extension and skill package for one local Obsidian vault. It keeps agents on a small, explicit tool surface instead of broad filesystem access.

It is not an Obsidian community plugin, desktop GUI, pane, or automatic vault organizer.

## Tools at a glance

The package registers eight Pi tools plus one slash command:

| Tool or command | Use it for | Supports |
| --- | --- | --- |
| `obsidian_config` | Remembering or checking the vault path | `set_vault`, `forget_vault`, `status` |
| `obsidian_retrieve` | Read-only note discovery and bounded context | `auto`, `search`, `context`, `graph`, `project`, `note`, `relationships` |
| `obsidian_validate` | Advisory Markdown checks | `existing_note`, `proposed_content` |
| `obsidian_plan` | Previewing non-destructive operation sequences | preview-only, max 25 operations, never executes |
| `obsidian_write` | Creating notes, appending Markdown, creating folders | `create`, `append`, `create_folder` |
| `obsidian_edit` | Structured edits to existing notes | `replace_section`, `insert_under_heading`, `update_frontmatter`, `remove_frontmatter`, `replace_exact_text` |
| `obsidian_manage` | Moving, trashing, restoring, or copying one note | `move_note`, `trash_note`, `restore_note`, `copy_note` |
| `obsidian_destroy` | Explicit permanent destructive actions | `delete_note`, `delete_folder`, `replace_note`, `empty_trash` |
| `/obsidian-vault` | Status, vault selection, app readiness, and session approval controls | status, `set-vault`, `forget-vault`, auto-open, auto-write, auto-destroy |

## Configuration and vault resolution

Most users do not configure anything. Pi either auto-detects the vault from Obsidian Desktop or remembers the one path you set. Auto-open is enabled by default for vault-touching tools and can be toggled per session.

There is only one normal persistent setting: `vaultPath`.

It is stored in:

```text
$HOME/.pi/agent/obsidian-vault.json
```

Normal users should set it through `obsidian_config` or `/obsidian-vault set-vault`; you do not need to edit config files by hand.

Technical resolution order:

1. `OBSIDIAN_VAULT_PATH` hidden/dev override
2. remembered `vaultPath`
3. Obsidian Desktop auto-detect
4. setup-needed response asking for the vault folder path

`/obsidian-vault status` reports local vault path and mutation readiness. It is intentionally small and is not a complete retrieval/CLI health check.

Useful commands:

```text
/obsidian-vault
/obsidian-vault set-vault <path>
/obsidian-vault forget-vault
/obsidian-vault auto-open status
/obsidian-vault auto-open on
/obsidian-vault auto-open off
/obsidian-vault auto-write status
/obsidian-vault auto-write on
/obsidian-vault auto-write off
/obsidian-vault auto-destroy status
/obsidian-vault auto-destroy on
/obsidian-vault auto-destroy off
```

`/obsidian vault ...` also works as an alias.

`Auto-open Obsidian`, `Auto-write this session`, and `Auto-destroy this session` are in-memory Pi session choices. Auto-open only checks/opens the configured or detected vault; it never authorizes writes or destruction. Auto-write and auto-destroy are separate, and auto-write never authorizes destructive operations.

## Agent workflow

For agents and power users, the intended flow is:

1. Retrieve candidates with `obsidian_retrieve`.
2. Read `agentGuidance`.
3. Request selected context only for exact returned `selectedRef` paths.
4. Validate or plan when useful.
5. Call the smallest write/edit/manage/destroy tool that matches the user's explicit request.

Retrieval is candidate-first, bounded, and read-only. It does not return full note bodies by default.

Use `mode: "note"` only with one explicit safe vault-relative Markdown path. Use `mode: "relationships"` only around one explicit Markdown note; there is no vault-wide backlink scan or broad vault/backlink scan.

`obsidian_validate` is workflow-neutral. Missing frontmatter, tags, templates, PARA, Zettelkasten, daily-note structure, or project-note structure are not errors. Suspicious path-like strings inside Markdown are warning-severity advisory issues.

`obsidian_plan` is preview-only. It never executes, stages, batches, writes files, or creates a transaction. If `dryRun: false` appears inside a plan, it is ignored with a warning.

For normal non-destructive mutation requests, agents should omit `dryRun`; the registered Pi tools preview internally and ask for human approval when the interactive UI is available. `dryRun: true` never commits. Destructive operations use `obsidian_destroy` and separate destructive approval.

Supported top-level request fields for `obsidian_retrieve` are exactly `query`, `mode`, `path`, `selected`, `scope`, `budget`, `maxCandidates`, `maxRelated`, `includeBacklinks`, `includeOutgoing`, `includeSections`, and `explain`.

Valid `budget` values: `tiny`, `standard`, `expanded`.

## Examples

Representative calls for each public tool:

### Configure

```json
{ "operation": "set_vault", "vaultPath": "/home/me/Documents/My Vault" }
```

```json
{ "operation": "forget_vault" }
```

```json
{ "operation": "status" }
```

### Retrieve

```json
{ "query": "project roadmap", "mode": "search", "budget": "standard" }
```

```json
{ "query": "Project Roadmap connections", "mode": "graph", "budget": "expanded" }
```

```json
{
  "mode": "context",
  "query": "implementation details",
  "selected": [{ "path": "Projects/Roadmap.md", "title": "Roadmap" }],
  "budget": "standard"
}
```

```json
{ "mode": "note", "path": "Projects/Roadmap.md", "budget": "tiny" }
```

```json
{ "mode": "relationships", "path": "Projects/Roadmap.md", "budget": "standard", "maxRelated": 10, "includeBacklinks": true }
```

### Validate

```json
{
  "target": "proposed_content",
  "content": "# Roadmap\n\nSee [Plan](Plan.md).",
  "expectedPath": "Projects/Roadmap.md"
}
```

```json
{ "target": "existing_note", "path": "Projects/Roadmap.md", "budget": "tiny" }
```

### Plan

```json
{
  "operations": [
    { "tool": "obsidian_write", "operation": "create", "path": "Projects/New Idea.md", "content": "# New Idea\n" },
    { "tool": "obsidian_edit", "operation": "replace_exact_text", "path": "Projects/Roadmap.md", "oldText": "old", "newText": "new" }
  ]
}
```

### Write

```json
{ "operation": "create", "title": "New Idea", "folderHint": "Projects", "content": "# New Idea\n\nDetails." }
```

```json
{ "operation": "append", "path": "Projects/Roadmap.md", "content": "\n## Update\n\nNew notes." }
```

```json
{ "operation": "create_folder", "path": "Projects/New Area" }
```

### Edit

```json
{ "operation": "replace_exact_text", "path": "Projects/Roadmap.md", "oldText": "Old phrase", "newText": "New phrase" }
```

### Manage one note

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

`trash_note` is a recoverable move-to-trash, not permanent deletion. `copy_note` is byte-for-byte and does not rewrite links.

### Destroy explicitly

These require explicit destructive approval.

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

## Safety model

Read-only tools (`obsidian_retrieve`, `obsidian_validate`, `obsidian_plan`) do not mutate the vault.

Normal mutation tools (`obsidian_write`, `obsidian_edit`, `obsidian_manage`) preview before commit and use human approval or session auto-write through Pi. `obsidian_destroy` is the only tool for permanent delete, recursive folder delete, full-note replacement, or empty trash, and it uses separate destructive approval.

Hard rails include:

- safe vault-relative Markdown paths only for note targets
- no absolute paths, traversal, hidden paths, `.obsidian` paths, wildcard or bulk operations
- no overwrite, suffixing, auto-renaming, fuzzy destructive targets, or accidental full-note overwrite
- no broad vault scans, broad vault dumps, or broad backlink scans
- no automatic link rewriting
- no templates or automatic organization
- no transactions, batch execution, arbitrary CLI commands, Shell execution, network calls, GUI automation, pane automation, or user-requested UI-open behavior

The retrieval adapter uses a read-only command allowlist and `shell:false`. The only desktop launch behavior is the centralized auto-open preflight for the configured/detected vault.

Outputs are designed and tested to redact common sensitive local details such as vault roots and absolute paths. Vault-relative paths such as `Projects/Roadmap.md` are normal and may appear.

## Limitations and troubleshooting

- Retrieval may degrade or return setup guidance when Obsidian Desktop or the controlled CLI adapter is unavailable.
- If retrieval or existing-note validation says Obsidian CLI setup is required: go to Obsidian Settings → General → Advanced → CLI (Command line interface), enable it, then click Register for PATH. If CLI is already enabled but PATH is not registered, uncheck/re-check CLI, then click Register for PATH.
- Relationship/backlink metadata can degrade; there is no broad backlink scan.
- Mutations require explicit safe targets. The tools do not fuzzy-pick notes for edits, moves, deletes, or restores.
- Move/copy destinations must not already exist. No overwrite means existing destinations are refused rather than overwritten.
- `copy_note` preserves bytes and does not rewrite links.
- `trash_note` moves into `_Trash` by default. Permanent destruction lives only in `obsidian_destroy`.
- Release checks use temporary or disposable vaults. Real-vault checks are opt-in/manual only.
- Release safety posture includes no-overwrite, no-shell/network, no-broad-scan, human approval/auto-write separation, and redaction checks.

If auto-write or auto-destroy is on and you want prompts again:

```text
/obsidian-vault auto-write off
/obsidian-vault auto-destroy off
```

If the vault is wrong:

```text
/obsidian-vault set-vault /path/to/other/vault
```

or ask the agent naturally.

## Security and issues

Please report security-sensitive issues using [SECURITY.md](./SECURITY.md). Do not include private vault contents, secrets, or absolute local paths in public issues.
