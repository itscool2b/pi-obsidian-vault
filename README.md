# Pi Obsidian Vault Harness

A small Pi extension for safe Obsidian vault retrieval, controlled Markdown writing, safe structured editing, and controlled single-note management.

- Retrieval uses the official `obsidian`/`obsidian-cli` CLI and remains strictly read-only.
- Writing uses explicit vault-relative paths under a configured local vault path and supports only Markdown create/append, folder creation, and dry-run preview.
- Structured editing uses explicit vault-relative Markdown paths to existing notes and supports only section replacement/insertion, top-of-file frontmatter property updates/removals, and literal exact-text replacement.
- Note management uses explicit vault-relative Markdown paths and supports only dry-run-first single-note `move_note` moves/renames, recoverable `trash_note` moves to a vault-internal trash folder, explicit `restore_note` restores from that trash folder, and byte-for-byte `copy_note` copies.

## Public tool surface

The extension registers four Pi-facing tools:

- `obsidian_retrieve` — candidate-first search, selected-note context, graph summaries, project/topic retrieval, and explicit-path note inspection. Strictly read-only.
- `obsidian_write` — safe explicit-path Markdown note creation, append-only updates, and explicit folder creation. Dry-run preview is the default.
- `obsidian_edit` — safe structured edits to existing Markdown notes. Dry-run preview is the default.
- `obsidian_manage` — safe single-note move/rename management via `move_note`, recoverable single-note trash via `trash_note`, explicit restore from trash via `restore_note`, and byte-for-byte single-note copy via `copy_note`. Dry-run preview is the default.

It also registers the existing status command:

- `/obsidian-vault` — reports retrieval CLI/vault configuration health plus a compact retrieve/write/edit/manage capability table as available, unavailable, or degraded without exposing the local vault root.

## Recommended agent workflow

1. Use `obsidian_retrieve` first to retrieve candidates with `mode: "search"`, `mode: "graph"`, or a bounded `mode: "project"` request.
2. Read `agentGuidance`; when it recommends selected context, call `obsidian_retrieve` again with `mode: "context"` and only the exact `selectedRef` paths returned by the previous response.
3. When the user already provides one explicit safe vault-relative Markdown note path and asks what is in that note, use `obsidian_retrieve` with `mode: "note"` and `path` for bounded structured metadata; it does not return full note content by default.
4. Answer from retrieved context or inspection metadata when possible. Do not request a vault dump or infer a mutation target from a topic query.
5. Use `obsidian_write`, `obsidian_edit`, or `obsidian_manage` only after the user provides explicit safe vault-relative path(s) for the requested create/append/folder/edit/move/trash/restore/copy operation.
6. Preview first with omitted `dryRun` or `dryRun: true`; commit only after confirmation with `dryRun: false`. Manage dry-run previews may include link-impact metadata, but links are never rewritten automatically.

Legacy broad read/search/list/write/open-style tools are intentionally not registered. `obsidian_retrieve` warns on write/edit/open/move/trash/restore/copy intent and never performs side effects. `obsidian_write` refuses overwrite, delete, trash, rename, move, restore, copy, open UI, shell, network, scan, filesystem discovery, structured edit, destructive folder, and arbitrary command requests. `obsidian_edit` refuses note/folder creation, full-note overwrite, delete, trash, rename, move, restore, copy, open UI, shell, network, scan, regex/fuzzy/semantic replacement, and arbitrary command requests. `obsidian_manage` refuses everything except `move_note`, `trash_note`, `restore_note`, and `copy_note`, including permanent delete, folder delete, recursive delete/restore/copy, wildcard delete/restore/copy, bulk delete/restore/copy, non-Markdown delete/restore/copy, folder moves/restores/copies, overwrite, link rewriting, UI open, shell, network, scan, filesystem discovery, and arbitrary command requests.

## First-time setup

1. Make the vault location persistent for Pi. The simplest option is:

```bash
mkdir -p ~/.pi/agent
cat > ~/.pi/agent/obsidian-vault.json <<'JSON'
{
  "vaultPath": "/absolute/path/to/vault",
  "cliPath": "obsidian-cli"
}
JSON
```

Replace `/absolute/path/to/vault` with your real vault folder, then run `/obsidian-vault` in Pi. The status command is side-effect-free: it reports whether the CLI can reach a running Obsidian instance, whether local writes are available, and whether `obsidian_edit` and `obsidian_manage` are available, unavailable, or degraded. It does not open Obsidian and does not expose the local vault root in status output. If `obsidian` opens the desktop app on your system, use `obsidian-cli` for `cliPath`/`OBSIDIAN_CLI_PATH`.

`obsidian_write`, `obsidian_edit`, and `obsidian_manage` require a local `vaultPath`/`OBSIDIAN_VAULT_PATH`. Vault name/id targets are retrieval-only because safe local mutations must be resolved under a configured local vault directory.

### Pi-assisted setup prompt

You can also ask Pi to create the config for you. Paste this into Pi after replacing the vault path:

```text
Set up the Obsidian extension.

My Obsidian vault path is:

/replace/with/path/to/vault

Please:
1. Create or update ~/.pi/agent/obsidian-vault.json.
2. Set "vaultPath" to the path above.
3. Prefer "cliPath": "obsidian-cli" if obsidian-cli exists on PATH; otherwise ask me before using any other CLI path.
4. Verify the vault path exists and is a directory.
5. Do not scan, read, modify, open, or write any notes in the vault.
6. After setup, tell me whether I need to restart Pi.
7. Ask me to run /obsidian-vault and confirm it shows Source: config, Writes: available, obsidian_edit: available, and obsidian_manage: available.
```

You can also configure through environment variables:

```env
OBSIDIAN_CLI_PATH=obsidian-cli
OBSIDIAN_VAULT_PATH=/absolute/path/to/vault
# or retrieval-only targets:
OBSIDIAN_VAULT_NAME="My Vault"
OBSIDIAN_VAULT_ID="vault-id"

OBSIDIAN_CLI_TIMEOUT_MS=10000
OBSIDIAN_RETRIEVE_TINY_CHARS=3500
OBSIDIAN_RETRIEVE_STANDARD_CHARS=8000
OBSIDIAN_RETRIEVE_EXPANDED_CHARS=12000
```

When a vault name/id is configured, the retrieval adapter invokes the configured CLI as `<cliPath> vault=<target> <command> ...`. Otherwise it runs the CLI with `cwd` set to `OBSIDIAN_VAULT_PATH` or the path saved in `~/.pi/agent/obsidian-vault.json`.

## Retrieval usage examples

Supported top-level request fields for `obsidian_retrieve` are exactly: `query`, `mode`, `path`, `selected`, `scope`, `budget`, `maxCandidates`, and `explain`.

Valid `mode` values: `auto`, `search`, `context`, `graph`, `project`, `note`.
Valid `budget` values: `tiny`, `standard`, `expanded`.

Candidate discovery:

```json
{ "query": "integrated gradients", "mode": "search", "budget": "standard" }
```

Graph retrieval:

```json
{ "query": "Integrated Gradients connections", "mode": "graph", "budget": "expanded" }
```

Selected-note context using the exact `selectedRef` recommended by `agentGuidance.contextRecommendation`:

```json
{
  "mode": "context",
  "query": "implementation details",
  "selected": [{ "path": "Research/Integrated Gradients/index.md", "title": "Integrated Gradients" }],
  "budget": "standard"
}
```

Agent-facing guidance is returned on every successful retrieval response:

```json
{
  "agentGuidance": {
    "resultState": "request_context",
    "bestMatch": { "path": "Research/Integrated Gradients/index.md", "title": "Integrated Gradients" },
    "confidence": { "level": "high", "ambiguous": false },
    "contextRecommendation": {
      "recommended": true,
      "selected": [{ "path": "Research/Integrated Gradients/index.md", "title": "Integrated Gradients" }],
      "mode": "context"
    }
  }
}
```

Project retrieval:

```json
{ "query": "Pi retrieval architecture", "mode": "project", "scope": { "folder": "Projects" }, "budget": "standard" }
```

Explicit note inspection returns bounded metadata such as frontmatter keys, headings, duplicate heading warnings, outgoing wiki/Markdown links, approximate counts, warnings, degraded signals, and next actions. It requires one explicit safe vault-relative Markdown `path` and omits full note content by default:

```json
{ "mode": "note", "path": "Projects/Plan.md", "budget": "tiny" }
```

## Write usage examples

Supported `obsidian_write` top-level request fields are exactly: `operation`, `path`, `content`, and `dryRun`.

Supported operations are `create`, `append`, and `create_folder`. `dryRun` defaults to `true`, so the first call previews without changing the vault.

Dry-run create preview:

```json
{ "operation": "create", "path": "Projects/New Idea.md", "content": "# New Idea\n", "dryRun": true }
```

Committed create after confirmation:

```json
{ "operation": "create", "path": "Projects/New Idea.md", "content": "# New Idea\n", "dryRun": false }
```

Append exactly supplied Markdown:

```json
{ "operation": "append", "path": "Projects/New Idea.md", "content": "\n## Follow-up\nMore notes.", "dryRun": false }
```

Dry-run folder creation preview:

```json
{ "operation": "create_folder", "path": "Projects/New Area", "dryRun": true }
```

Committed folder creation after confirmation:

```json
{ "operation": "create_folder", "path": "Projects/New Area", "dryRun": false }
```

`create_folder` requires an explicit safe vault-relative folder path, creates missing safe parent folders only when committed, rejects `content` with `validation_error` / `CONTENT_NOT_ALLOWED`, and never creates or modifies Markdown files. Existing folders return deterministic conflict results. File-looking folder targets such as `Folder.md` or `Folder.txt`, hidden folders, `.obsidian`, absolute paths, and traversal are refused.

`create` never overwrites existing notes. `append` never creates missing notes. Forbidden or unsupported operations return `safety_refusal`.

## Structured edit usage examples

Supported `obsidian_edit` top-level request fields are exactly: `operation`, `path`, `heading`, `content`, `property`, `value`, `oldText`, `newText`, and `dryRun`.

Supported operations are `replace_section`, `insert_under_heading`, `update_frontmatter`, `remove_frontmatter`, and `replace_exact_text`. `dryRun` defaults to `true`, so the first call previews without changing the vault.

Dry-run section replacement preview:

```json
{
  "operation": "replace_section",
  "path": "Projects/New Idea.md",
  "heading": "## Plan",
  "content": "Updated plan text.",
  "dryRun": true
}
```

Insert Markdown immediately below an exact heading after confirmation:

```json
{
  "operation": "insert_under_heading",
  "path": "Projects/New Idea.md",
  "heading": "## Log",
  "content": "- Follow-up item.\n",
  "dryRun": false
}
```

Update a top-of-file frontmatter property:

```json
{
  "operation": "update_frontmatter",
  "path": "Projects/New Idea.md",
  "property": "status",
  "value": "reviewed",
  "dryRun": false
}
```

Remove a top-of-file frontmatter property:

```json
{
  "operation": "remove_frontmatter",
  "path": "Projects/New Idea.md",
  "property": "draft",
  "dryRun": false
}
```

Preview a literal exact-text replacement:

```json
{
  "operation": "replace_exact_text",
  "path": "Projects/New Idea.md",
  "oldText": "Replace this exact sentence.",
  "newText": "Replacement sentence committed safely.",
  "dryRun": true
}
```

Commit the same exact-text replacement after confirmation by sending the same explicit `path`, `oldText`, and `newText` with `dryRun: false`.

Section headings must match exactly after Markdown heading normalization. Duplicate matching headings return `ambiguous`; missing headings and missing notes return `not_found`. Frontmatter edits affect only YAML frontmatter at the very top of the file and preserve the note body outside frontmatter. Exact-text edits match `oldText` literally once with no regex, fuzzy, semantic, normalized, or inferred matching; missing text returns `not_found`, duplicate text returns `ambiguous`, and full-note replacement is refused.

## Manage usage examples

Supported `obsidian_manage` top-level request fields are exactly: `operation`, `fromPath`, `toPath`, `path`, `trashPath`, `trashFolder`, and `dryRun`.

The supported operations are exactly `move_note`, `trash_note`, `restore_note`, and `copy_note`. `dryRun` defaults to `true`, so the first call previews without moving or copying anything. Dry-run previews may include bounded `linkImpact` counts for outgoing wiki and Markdown links plus `linkRewriteSupported: false`; the extension does not scan broadly for inbound backlinks and never rewrites links automatically.

Dry-run note move preview:

```json
{ "operation": "move_note", "fromPath": "Projects/Plan.md", "toPath": "Archive/Plan.md", "dryRun": true }
```

Committed move after confirmation:

```json
{ "operation": "move_note", "fromPath": "Projects/Plan.md", "toPath": "Archive/Plan.md", "dryRun": false }
```

Rename within the same folder:

```json
{ "operation": "move_note", "fromPath": "Projects/Plan.md", "toPath": "Projects/Roadmap.md", "dryRun": false }
```

`move_note` requires both paths to be explicit safe vault-relative Markdown note paths. The source note must already exist, the destination path must not exist, and the destination parent folder must already exist. Missing sources return deterministic `not_found` / `SOURCE_NOT_FOUND`; missing destination parents return deterministic `not_found` / `PARENT_MISSING`; existing destinations return deterministic `conflict` / `TARGET_EXISTS`; parent files return deterministic `conflict` / `PARENT_NOT_FOLDER`.

`move_note` moves or renames exactly one Markdown file. It does not move folders, overwrite destinations, delete, copy, rewrite links, create parent folders, open Obsidian, scan or discover the vault, run shell/network calls, or execute arbitrary CLI commands.

Dry-run note trash preview with the default `_Trash` folder:

```json
{ "operation": "trash_note", "path": "Projects/Plan.md", "dryRun": true }
```

Committed recoverable trash after confirmation:

```json
{ "operation": "trash_note", "path": "Projects/Plan.md", "dryRun": false }
```

Trash to an explicit safe folder:

```json
{ "operation": "trash_note", "path": "Projects/Plan.md", "trashFolder": "Archive/Trash", "dryRun": false }
```

`trash_note` requires `path` to be an explicit safe vault-relative Markdown note path. Optional `trashFolder` must be an explicit safe vault-relative folder path; when omitted it defaults to `_Trash`. Dry-run previews do not move notes or create folders. A committed request creates the safe trash folder if needed and moves exactly one Markdown note to `trashFolder/<source filename>` while preserving note content.

`trash_note` is recoverable move-to-trash behavior inside the vault, not permanent deletion. Missing sources return deterministic `not_found` / `SOURCE_NOT_FOUND`; non-Markdown source paths return deterministic `validation_error` / `SOURCE_NOT_MARKDOWN`; source folders return deterministic `safety_refusal` / `SOURCE_IS_FOLDER`; unsafe trash folders return deterministic `safety_refusal` / `UNSAFE_TRASH_FOLDER`; existing final trash paths return deterministic `conflict` / `TRASH_TARGET_EXISTS` with no overwrite, suffixing, or auto-rename; trash-folder files return deterministic `conflict` / `TRASH_FOLDER_NOT_FOLDER`.

Dry-run restore preview from the default `_Trash` folder:

```json
{ "operation": "restore_note", "trashPath": "_Trash/Plan.md", "toPath": "Projects/Plan.md", "dryRun": true }
```

Committed restore after confirmation:

```json
{ "operation": "restore_note", "trashPath": "_Trash/Plan.md", "toPath": "Projects/Plan.md", "dryRun": false }
```

Restore from an explicit safe trash folder:

```json
{ "operation": "restore_note", "trashPath": "Archive/Trash/Plan.md", "toPath": "Projects/Plan.md", "trashFolder": "Archive/Trash", "dryRun": false }
```

`restore_note` requires `trashPath` to be an explicit safe vault-relative Markdown note path inside the selected/default `trashFolder` and `toPath` to be an explicit safe vault-relative Markdown destination whose parent folder already exists. It restores exactly one regular Markdown file by moving it out of the trash folder while preserving content.

Deterministic restore outcomes include `validation_error` / `SAME_PATH`, `TRASH_SOURCE_NOT_MARKDOWN`, or `TARGET_NOT_MARKDOWN`; `safety_refusal` / `TRASH_PATH_OUTSIDE_TRASH`, `TRASH_SOURCE_IS_FOLDER`, `TRASH_SOURCE_NOT_FILE`, or unsafe-path codes; `not_found` / `TRASH_SOURCE_NOT_FOUND` or `PARENT_MISSING`; and `conflict` / `TARGET_EXISTS`, `PARENT_NOT_FOLDER`, or `TRASH_FOLDER_NOT_FOLDER`. `restore_note` never overwrites, creates destination parents, suffixes or auto-renames, copies, rewrites links, searches the trash folder, restores folders, restores non-Markdown files, or performs recursive/wildcard/bulk restore.

Dry-run copy preview:

```json
{ "operation": "copy_note", "fromPath": "Projects/Plan.md", "toPath": "Archive/Plan Copy.md", "dryRun": true }
```

Committed copy after confirmation:

```json
{ "operation": "copy_note", "fromPath": "Projects/Plan.md", "toPath": "Archive/Plan Copy.md", "dryRun": false }
```

`copy_note` requires `fromPath` and `toPath` to be different explicit safe vault-relative Markdown note paths. The source note must already exist as one regular Markdown file, the destination path must not exist, and the destination parent folder must already exist. A dry-run preview does not copy anything. A committed request copies exactly one Markdown note byte-for-byte while leaving the source unchanged.

Deterministic copy outcomes include `validation_error` / `SAME_PATH`, `SOURCE_NOT_MARKDOWN`, `SOURCE_IS_FOLDER`, `SOURCE_NOT_FILE`, or `TARGET_NOT_MARKDOWN`; `safety_refusal` / unsafe-path codes; `not_found` / `SOURCE_NOT_FOUND` or `PARENT_MISSING`; and `conflict` / `TARGET_EXISTS` or `PARENT_NOT_FOLDER`. `copy_note` never overwrites, creates destination parents, suffixes or auto-renames, rewrites links, searches for alternatives, copies folders, copies non-Markdown files, or performs recursive/wildcard/bulk copy.

## Safety model and intentionally unsupported operations

- `obsidian_retrieve` is read-only. It does not write, append, rename, move, trash, restore, copy, delete, open UI, run shell commands, or mutate notes.
- Obsidian CLI is the retrieval discovery and metadata backend.
- No filesystem scanning is used for retrieval discovery.
- Note content is loaded only for selected candidates in `context` mode.
- Retrieval responses are capped by budget and report omissions/truncation.
- Broad vault/folder/multi-note dump requests return candidates and bounded summaries, not full note bodies.
- CLI invocation uses argv arrays with `shell: false`.
- `obsidian_write` is separate from retrieval and only supports Markdown create/append, folder create_folder, and dry-run preview.
- `create_folder` creates only explicit safe vault-relative folders, rejects supplied content with `CONTENT_NOT_ALLOWED`, refuses hidden/.obsidian/traversal/absolute/extension-looking targets, and never creates or modifies Markdown files.
- `obsidian_edit` is separate from retrieval and writing and only supports structured edits to existing Markdown notes.
- `obsidian_manage` is separate from retrieval, writing, and editing and only supports `move_note`, `trash_note`, `restore_note`, and `copy_note` for exactly one existing Markdown note.
- `replace_exact_text` replaces only one exact literal span inside an existing note; it does not support regex, fuzzy matching, replace-all, occurrence selection, inferred target text, or full-note replacement.
- Write/edit/manage note paths must be explicit vault-relative Markdown paths. Folder creation paths must be explicit vault-relative non-root folder paths. Absolute paths, Windows absolute paths, `.`, `..`, hidden paths, `.obsidian`, non-Markdown note targets, extension-looking folder targets, and encoded traversal are refused.
- `obsidian_edit` never creates notes. Missing target notes return deterministic `not_found` / `TARGET_MISSING` results without partial mutation.
- `obsidian_manage move_note` never creates parent folders, overwrites destinations, moves folders, deletes, copies, rewrites links, scans, discovers, opens UI, shells out, or uses network calls. Missing destination parents return deterministic `not_found` / `PARENT_MISSING` results without partial mutation.
- `obsidian_manage trash_note` never permanently deletes, empties trash, moves folders, trashes non-Markdown files, handles recursive/wildcard/bulk paths, overwrites trash targets, auto-renames collisions, copies, rewrites links, scans, discovers, opens UI, shells out, or uses network calls. It creates only the explicit safe trash folder when committed and needed.
- `obsidian_manage restore_note` never permanently deletes, creates destination parents, overwrites destinations, auto-renames collisions, copies, rewrites links, searches trash contents, restores folders, restores non-Markdown files, handles recursive/wildcard/bulk paths, scans, discovers, opens UI, shells out, or uses network calls.
- `obsidian_manage copy_note` copies exactly one regular Markdown note byte-for-byte while preserving the source. It never overwrites, creates destination parents, auto-renames collisions, rewrites links, searches for alternatives, copies folders, copies non-Markdown files, handles recursive/wildcard/bulk paths, scans, discovers, opens UI, shells out, or uses network calls.
- Committed writes, folder creations, edits, manage moves, manage trash operations, manage restore operations, and manage copy operations are serialized per normalized vault-relative target path. `obsidian_manage move_note` locks both source and destination paths; `obsidian_manage trash_note` locks both source and final trash paths; `obsidian_manage restore_note` locks both trash source and destination paths; `obsidian_manage copy_note` locks both source and destination paths. They share the same target-lock namespace as `obsidian_write` and `obsidian_edit`; different safe target paths are not forced through a global queue.
- Write/edit/manage responses expose safe vault-relative paths only, not the configured vault root or absolute source/destination/trash/restore/copy/target paths.

## Development

```bash
npm run typecheck
npm test
npm run check
```

Focused write/edit/manage checks:

```bash
npm test -- write-contract write-filesystem write-dry-run write-folder write-path-safety write-concurrency
npm test -- edit-contract edit-dry-run edit-section edit-frontmatter edit-exact-text edit-path-safety edit-concurrency edit-tool-boundaries
npm test -- manage-contract manage-dry-run manage-filesystem manage-path-safety manage-concurrency manage-tool-boundaries
npm test -- manage-trash-dry-run manage-trash-filesystem manage-trash-path-safety manage-trash-concurrency
npm test -- manage-restore-dry-run manage-restore-filesystem manage-restore-path-safety manage-restore-concurrency
npm test -- manage-copy-dry-run manage-copy-filesystem manage-copy-path-safety manage-copy-concurrency
```

Real-vault evaluation is opt-in:

```bash
OBSIDIAN_EVAL_VAULT=true OBSIDIAN_EVAL_QUERY="project" npm test -- real-vault-evaluation
```
