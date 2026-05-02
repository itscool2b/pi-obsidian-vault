---
name: obsidian-research
description: Retrieve compact Obsidian vault context for research tasks through the read-only obsidian_retrieve tool. Safe Markdown create/append and folder creation are handled separately by obsidian_write, safe structured edits by obsidian_edit, and safe single-note moves/renames/trash/restores/copies by obsidian_manage.
---

# Obsidian Research

Use `obsidian_retrieve` for all Obsidian vault retrieval. Use `obsidian_write` only for explicit Markdown create/append or safe folder creation requests, use `obsidian_edit` only for explicit structured edits to existing Markdown notes, and use `obsidian_manage` only for explicit safe single-note move/rename, recoverable trash, restore-from-trash, or byte-for-byte copy requests.

## Workflow

1. Start with candidate discovery or explicit note inspection:
   - Supported top-level fields are exactly `query`, `mode`, `path`, `selected`, `scope`, `budget`, `maxCandidates`, and `explain`.
   - Valid `mode` values are `auto`, `search`, `context`, `graph`, `project`, and `note`.
   - Valid `budget` values are `tiny`, `standard`, and `expanded`.
   - Provide a focused query, alias, tag, property, project phrase, or folder scope.
2. Read `agentGuidance` before raw scores:
   - `resultState` tells you whether to answer, request context, clarify, or refine.
   - `bestMatch` identifies the recommended note.
   - `confidence` explains strength, ambiguity, and degraded signals.
   - `contextRecommendation.selected` gives the exact selected refs to use when context is recommended.
3. Request deeper context only for specific returned `selectedRef` paths and only when recommended:
   - `mode: "context"`
   - `selected: [{ "path": "...", "title": "..." }]`
4. Use returned context excerpts before making another retrieval call.
5. When the user already supplies one explicit safe vault-relative Markdown path and asks to understand that note before acting, use `mode: "note"` with `path` for bounded structured metadata; it omits full note content by default and never infers paths.
6. Only after retrieval/context/inspection confirms the user's intent, route explicit mutations to `obsidian_write`, `obsidian_edit`, or `obsidian_manage` with user-supplied safe vault-relative paths; never infer mutation targets from search results alone.
7. Use `mode: "graph"` or `mode: "project"` for bounded relationship/project summaries.

## Safety rules

- Do not use or ask for legacy Obsidian read/search/list/write/open tools.
- Do not request full vault, full folder, or multi-note dumps.
- If `agentGuidance.resultState` is `ambiguous` or `no_match`, clarify/refine instead of broadening context.
- Treat write/open intent as out of scope for retrieval; `obsidian_retrieve` is read-only.
- Use `obsidian_retrieve` `mode: "note"` only for one explicit safe vault-relative Markdown `path`; reject absolute, traversal, hidden, `.obsidian`, wildcard, recursive, bulk/list, folder-like, and non-Markdown paths instead of broadening or guessing.
- For explicit safe Markdown create/append requests, use the separate `obsidian_write` tool with `dryRun` preview first. Do not route writes through retrieval.
- For explicit safe folder creation requests, use `obsidian_write` with `operation: "create_folder"`, an explicit vault-relative folder path, and `dryRun` preview first. Omit `content`; if content is supplied, it is rejected with `CONTENT_NOT_ALLOWED` and no file is created or modified.
- For explicit safe existing-note structured edit requests, use the separate `obsidian_edit` tool with `dryRun` preview first. Do not route edits through retrieval or `obsidian_write`.
- For explicit safe single-note move/rename requests, use the separate `obsidian_manage` tool with `operation: "move_note"`, explicit safe vault-relative Markdown `fromPath` and `toPath`, and `dryRun` preview first. Do not route moves through retrieval, `obsidian_write`, or `obsidian_edit`. Review any dry-run `linkImpact` metadata; it is advisory and links are not rewritten automatically.
- For explicit safe recoverable single-note trash requests, use the separate `obsidian_manage` tool with `operation: "trash_note"`, explicit safe vault-relative Markdown `path`, optional explicit safe vault-relative `trashFolder`, and `dryRun` preview first. If `trashFolder` is omitted it defaults to `_Trash`. Review any dry-run `linkImpact` metadata; inbound links may be affected when backlink data is unavailable. Do not route trash through retrieval, `obsidian_write`, or `obsidian_edit`.
- For explicit safe single-note restore requests, use the separate `obsidian_manage` tool with `operation: "restore_note"`, explicit safe vault-relative Markdown `trashPath` inside the selected/default `trashFolder`, explicit safe vault-relative Markdown `toPath`, optional explicit safe `trashFolder`, and `dryRun` preview first. If `trashFolder` is omitted it defaults to `_Trash`. Do not infer restore sources from search, titles, aliases, metadata, or trash folder contents.
- For explicit safe single-note copy requests, use the separate `obsidian_manage` tool with `operation: "copy_note"`, explicit safe vault-relative Markdown `fromPath` and `toPath`, and `dryRun` preview first. `copy_note` copies exactly one regular Markdown note byte-for-byte while leaving the source unchanged. Review any dry-run `linkImpact` metadata; copied content links are preserved exactly and not rewritten. Do not route copies through retrieval, `obsidian_write`, or `obsidian_edit`; do not infer copy sources or destinations from search results.
- `obsidian_edit` supports only `replace_section`, `insert_under_heading`, `update_frontmatter`, `remove_frontmatter`, and `replace_exact_text` on explicit safe vault-relative Markdown paths to existing notes.
- Use exact ATX Markdown headings for section edits, e.g. `## Plan`; duplicate or missing headings must be reported to the user instead of guessed.
- Use frontmatter edits only for top-of-file YAML properties; `update_frontmatter` may create frontmatter, while `remove_frontmatter` requires the property to exist.
- Use `replace_exact_text` only when the user provides an explicit existing note path, non-empty `oldText`, and explicit `newText`; preview first, require exactly one literal match, and report missing or duplicate matches instead of guessing.
- `obsidian_manage move_note` requires the source to exist, destination to be absent, destination parent folder to already exist, and missing destination parents return `status=not_found` with `error.code=PARENT_MISSING`.
- `obsidian_manage trash_note` is recoverable move-to-trash, not permanent deletion. It requires the source note to exist, creates the safe trash folder only when committed with `dryRun:false`, and returns `status=conflict` with `error.code=TRASH_TARGET_EXISTS` if the computed final trash path already exists; do not suffix, auto-rename, overwrite, or search for alternatives.
- `obsidian_manage restore_note` is a recoverable move out of trash, not a search or bulk recovery tool. It requires `trashPath` inside the selected/default `trashFolder`, `toPath` whose parent folder already exists, and returns deterministic errors such as `TRASH_PATH_OUTSIDE_TRASH`, `TRASH_SOURCE_NOT_FOUND`, `TARGET_EXISTS`, `PARENT_MISSING`, `TRASH_SOURCE_IS_FOLDER`, `TRASH_SOURCE_NOT_FILE`, `TRASH_SOURCE_NOT_MARKDOWN`, `TARGET_NOT_MARKDOWN`, and `SAME_PATH` without mutation.
- `obsidian_manage copy_note` requires the source to exist as one regular Markdown note, destination to be absent, destination parent folder to already exist, and distinct normalized paths. It returns deterministic errors such as `SOURCE_NOT_FOUND`, `SOURCE_IS_FOLDER`, `SOURCE_NOT_FILE`, `SOURCE_NOT_MARKDOWN`, `TARGET_NOT_MARKDOWN`, `SAME_PATH`, `TARGET_EXISTS`, `PARENT_MISSING`, and `PARENT_NOT_FOLDER` without partial mutation.
- Never use any Obsidian tool for full-note overwrite, permanent delete, folder delete, recursive delete/restore/copy, wildcard delete/restore/copy, bulk delete/restore/copy, non-Markdown delete/restore/copy, folder moves/restores/copies, destructive folder management, UI open, shell execution, network calls, broad scanning, filesystem discovery, regex/fuzzy/semantic replacement, inferred target text, link rewriting, overwrite-copy, or arbitrary CLI commands. Use `obsidian_manage` only for the explicit single-note `move_note`, recoverable `trash_note`, explicit `restore_note`, and explicit byte-for-byte `copy_note` exceptions.
- Prefer `budget: "tiny"` for quick orientation, `budget: "standard"` for normal research, and `budget: "expanded"` only when bounded graph/context detail is needed.

## Good examples

```json
{ "query": "integrated gradients", "mode": "search", "budget": "standard" }
```

```json
{ "query": "Integrated Gradients connections", "mode": "graph", "budget": "expanded" }
```

```json
{ "mode": "context", "query": "implementation", "selected": [{ "path": "Research/Integrated Gradients/index.md", "title": "Integrated Gradients" }], "budget": "standard" }
```

```json
{ "mode": "note", "path": "Research/Integrated Gradients/index.md", "budget": "tiny" }
```

Safe folder creation preview:

```json
{ "operation": "create_folder", "path": "Projects/New Area", "dryRun": true }
```

Safe exact-text edit preview:

```json
{ "operation": "replace_exact_text", "path": "Projects/Plan.md", "oldText": "Old exact sentence.", "newText": "New exact sentence.", "dryRun": true }
```

Safe single-note move preview:

```json
{ "operation": "move_note", "fromPath": "Projects/Plan.md", "toPath": "Archive/Plan.md", "dryRun": true }
```

Safe recoverable single-note trash preview:

```json
{ "operation": "trash_note", "path": "Projects/Plan.md", "trashFolder": "_Trash", "dryRun": true }
```

Safe single-note restore preview:

```json
{ "operation": "restore_note", "trashPath": "_Trash/Plan.md", "toPath": "Projects/Plan.md", "dryRun": true }
```

Safe single-note copy preview:

```json
{ "operation": "copy_note", "fromPath": "Projects/Plan.md", "toPath": "Archive/Plan Copy.md", "dryRun": true }
```
