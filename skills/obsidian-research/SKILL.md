---
name: obsidian-research
description: Retrieve compact Obsidian vault context and bounded explicit-note relationships through obsidian_retrieve, preview operation plans through obsidian_plan, and validate Markdown safely through obsidian_validate. Safe Markdown create/append and folder creation are handled by obsidian_write, safe structured edits by obsidian_edit, safe single-note move/rename, trash, restore, and copy operations by obsidian_manage, and explicit destructive operations by obsidian_destroy.
---

# Obsidian Research

Use `obsidian_retrieve` for Obsidian vault retrieval, including `mode: "relationships"` for one explicit safe Markdown note path. Use `obsidian_plan` for read-only bounded non-destructive previews when the user asks to plan. Use `obsidian_validate` for read-only workflow-neutral Markdown validation. Use `obsidian_config` only when the user gives a vault folder path or asks to forget/check the remembered vault. Vault-touching tool calls auto-check whether Obsidian is running and auto-open the configured/detected vault when possible. For explicit permanent delete/full replace requests, use `obsidian_destroy`. For normal mutation requests, call `obsidian_write`, `obsidian_edit`, or `obsidian_manage` directly; the extension previews internally, asks the human for approval in Pi, and commits only if approved.

## Workflow

1. Start with candidate discovery or explicit note inspection:
   - Supported top-level fields are exactly `query`, `mode`, `path`, `selected`, `scope`, `budget`, `maxCandidates`, `maxRelated`, `includeBacklinks`, `includeOutgoing`, `includeSections`, and `explain`.
   - Valid `mode` values are `auto`, `search`, `context`, `graph`, `project`, `note`, and `relationships`.
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
6. When the user supplies one explicit safe vault-relative Markdown path and asks about links, backlinks, related notes, or link impact, use `mode: "relationships"` with `path`; keep `includeSections` false unless tiny section relationship summaries are specifically useful.
7. Use `obsidian_validate` when you need to check Markdown safety before suggesting edits or asking to commit content. Use `target: "existing_note"` with one explicit safe Markdown path, or `target: "proposed_content"` with explicit content; do not use validation for discovery.
8. Use `obsidian_plan` to preview a bounded sequence of explicit non-destructive planned operations, detect conflicts/order hazards, and summarize virtual effects. Treat it as read-only advisory output; never use it as batch execution. Use `obsidian_destroy` `dryRun: true` for destructive previews.
9. If setup is missing and the user provides an Obsidian vault folder path, call `obsidian_config` with `operation: "set_vault"`. This is the only normal persistent setting, and successful setup may auto-open that vault.
10. For explicit destructive requests, route to `obsidian_destroy`; auto-write does not apply and destructive approval is separate.
11. For normal mutation requests, route to `obsidian_write`, `obsidian_edit`, or `obsidian_manage` and omit `dryRun`; the extension handles the preview + human approval + commit flow. If the human chose `Auto-write this session`, later mutations in the same Pi session skip the prompt after internal preview/safety checks.
12. Use `dryRun: true` only when the user explicitly asks to preview/check/plan without changing the vault; dry runs never commit, even when auto-write or auto-destroy is enabled.
13. Use `mode: "graph"` or `mode: "project"` for bounded query-centered relationship/project summaries; use `mode: "relationships"` for explicit-note relationship summaries.

## Safety rules

- Do not use or ask for legacy Obsidian read/search/list/write/open tools.
- Do not request full vault, full folder, or multi-note dumps.
- If `agentGuidance.resultState` is `ambiguous` or `no_match`, clarify/refine instead of broadening context.
- Treat write/open intent as out of scope for retrieval; `obsidian_retrieve` is read-only.
- Use `obsidian_retrieve` `mode: "note"` only for one explicit safe vault-relative Markdown `path`; reject absolute, traversal, hidden, `.obsidian`, wildcard, recursive, bulk/list, folder-like, and non-Markdown paths instead of broadening or guessing.
- Use `obsidian_retrieve` `mode: "relationships"` only for one explicit safe vault-relative Markdown `path`. It returns bounded outgoing links, safe inbound references only when already available, related-note metadata, and link impact. It must not infer paths from titles/search/folders, perform broad backlink scans, crawl recursively, dump full notes/sections, rewrite links, or infer mutation targets.
- Use `obsidian_validate` only for read-only validation. `target="existing_note"` reads exactly one explicit safe vault-relative Markdown path; `target="proposed_content"` validates explicit non-empty Markdown content without vault access. Validation is advisory and workflow-neutral.
- Missing frontmatter, tags, status/date/source fields, templates, PARA, Zettelkasten, daily-note structure, project-note structure, and other methodology choices are not validation errors.
- Suspicious absolute-looking, Windows absolute-looking, UNC-looking, traversal-looking, or `.obsidian`-looking strings inside Markdown content are warning-severity advisory issues and do not make `valid:false` by themselves. Unsafe request `path` and `expectedPath` fields are refused before content validation.
- Never use `obsidian_validate` for templates, template variables, path generation, automatic folder creation, backlinks, relationship summaries, transaction previews, link rewriting, broad vault access, shell/network calls, arbitrary UI automation, or arbitrary CLI execution.
- Use `obsidian_plan` only for read-only previews of explicit non-destructive planned operations. It may mirror retrieve note, retrieve.relationships, validate existing/proposed content, write create/append/create_folder, edit replace_section/insert_under_heading/update_frontmatter/remove_frontmatter/replace_exact_text, and manage move_note/trash_note/restore_note/copy_note. It does not plan `obsidian_destroy`; use `obsidian_destroy` `dryRun: true` for destructive previews. It never executes, commits, stages, batches, transactionally applies, reserves paths, creates locks, rewrites links, scans broadly, shells out, uses network, automates UI, or generates destinations.
- If `obsidian_plan` returns `valid:false`, revise the plan. If it returns `valid:true`, use the relevant mutation tool normally; `dryRun:false` inside a planned operation is warning-only and ignored by `obsidian_plan`.
- For Markdown create/append requests, use the separate `obsidian_write` tool. For create, provide a path when obvious, or provide `title` / `folderHint` and content so the tool can infer a safe `.md` path. Do not route writes through retrieval.
- For safe folder creation requests, use `obsidian_write` with `operation: "create_folder"` and a vault-relative folder path. Omit `content`; if content is supplied, it is rejected with `CONTENT_NOT_ALLOWED` and no file is created or modified.
- For existing-note structured edit requests, use the separate `obsidian_edit` tool. Do not route edits through retrieval or `obsidian_write`.
- For safe single-note move/rename requests, use the separate `obsidian_manage` tool with `operation: "move_note"`, explicit safe vault-relative Markdown `fromPath` and `toPath`. Do not route moves through retrieval, `obsidian_write`, or `obsidian_edit`. Review any preview `linkImpact` metadata; it is advisory and links are not rewritten automatically.
- For safe recoverable single-note trash requests, use the separate `obsidian_manage` tool with `operation: "trash_note"`, explicit safe vault-relative Markdown `path`, and optional explicit safe vault-relative `trashFolder`. If `trashFolder` is omitted it defaults to `_Trash`. Review any preview `linkImpact` metadata; inbound links may be affected when backlink data is unavailable. Do not route trash through retrieval, `obsidian_write`, or `obsidian_edit`.
- For safe single-note restore requests, use the separate `obsidian_manage` tool with `operation: "restore_note"`, explicit safe vault-relative Markdown `trashPath` inside the selected/default `trashFolder`, explicit safe vault-relative Markdown `toPath`, and optional explicit safe `trashFolder`. If `trashFolder` is omitted it defaults to `_Trash`. Do not infer restore sources from search, titles, aliases, metadata, or trash folder contents.
- For safe single-note copy requests, use the separate `obsidian_manage` tool with `operation: "copy_note"`, explicit safe vault-relative Markdown `fromPath` and `toPath`. `copy_note` copies exactly one regular Markdown note byte-for-byte while leaving the source unchanged. Review any preview `linkImpact` metadata; copied content links are preserved exactly and not rewritten. Do not route copies through retrieval, `obsidian_write`, or `obsidian_edit`; do not infer copy sources or destinations from search results.
- `obsidian_edit` supports only `replace_section`, `insert_under_heading`, `update_frontmatter`, `remove_frontmatter`, and `replace_exact_text` on explicit safe vault-relative Markdown paths to existing notes.
- Use exact ATX Markdown headings for section edits, e.g. `## Plan`; duplicate or missing headings must be reported to the user instead of guessed.
- Use frontmatter edits only for top-of-file YAML properties; `update_frontmatter` may create frontmatter, while `remove_frontmatter` requires the property to exist.
- Use `replace_exact_text` only when the user provides an explicit existing note path, non-empty `oldText`, and explicit `newText`; preview first, require exactly one literal match, and report missing or duplicate matches instead of guessing.
- `obsidian_manage move_note` requires the source to exist, destination to be absent, destination parent folder to already exist, and missing destination parents return `status=not_found` with `error.code=PARENT_MISSING`.
- `obsidian_manage trash_note` is recoverable move-to-trash, not permanent deletion. It requires the source note to exist, creates the safe trash folder only when committed with `dryRun:false`, and returns `status=conflict` with `error.code=TRASH_TARGET_EXISTS` if the computed final trash path already exists; do not suffix, auto-rename, overwrite, or search for alternatives.
- `obsidian_manage restore_note` is a recoverable move out of trash, not a search or bulk recovery tool. It requires `trashPath` inside the selected/default `trashFolder`, `toPath` whose parent folder already exists, and returns deterministic errors such as `TRASH_PATH_OUTSIDE_TRASH`, `TRASH_SOURCE_NOT_FOUND`, `TARGET_EXISTS`, `PARENT_MISSING`, `TRASH_SOURCE_IS_FOLDER`, `TRASH_SOURCE_NOT_FILE`, `TRASH_SOURCE_NOT_MARKDOWN`, `TARGET_NOT_MARKDOWN`, and `SAME_PATH` without mutation.
- `obsidian_manage copy_note` requires the source to exist as one regular Markdown note, destination to be absent, destination parent folder to already exist, and distinct normalized paths. It returns deterministic errors such as `SOURCE_NOT_FOUND`, `SOURCE_IS_FOLDER`, `SOURCE_NOT_FILE`, `SOURCE_NOT_MARKDOWN`, `TARGET_NOT_MARKDOWN`, `SAME_PATH`, `TARGET_EXISTS`, `PARENT_MISSING`, and `PARENT_NOT_FOLDER` without partial mutation.

- Use `obsidian_destroy` only when the user explicitly asks for permanent destructive behavior: `delete_note`, `delete_folder`, `replace_note`, or `empty_trash`. It requires separate destructive approval (`Yes, destroy` / `No` / `Auto-destroy this session`). Auto-write does not authorize it.
- `obsidian_destroy delete_note` requires one explicit safe vault-relative Markdown note path. `delete_folder` requires one explicit safe vault-relative folder path and is recursive. `replace_note` requires one explicit existing Markdown note path plus full replacement content. `empty_trash` empties the default `_Trash` folder.
- Never infer destructive targets from search results, titles, aliases, folders, or relationship summaries. Never use `obsidian_destroy` for wildcard, bulk, hidden, `.obsidian`, symlink, special-file, shell/network, or arbitrary command requests.
- `obsidian_write` create/append previews may include advisory validation metadata for supplied content; warning/info issues do not block commits, and append validation checks only the supplied appended content in this batch. Mutations ask the human before committing in interactive Pi sessions unless session-local auto-write is enabled.
- Never use non-destroy Obsidian tools for full-note overwrite, permanent delete, folder delete, recursive delete/restore/copy, wildcard delete/restore/copy, bulk delete/restore/copy, non-Markdown delete/restore/copy, folder moves/restores/copies, destructive folder management, arbitrary UI open/automation, shell execution, network calls, broad scanning, filesystem discovery, regex/fuzzy/semantic replacement, inferred target text, link rewriting, overwrite-copy, templates, broad backlinks, transaction previews, batch execution, or arbitrary CLI commands. Use `obsidian_manage` only for the explicit single-note `move_note`, recoverable `trash_note`, explicit `restore_note`, and explicit byte-for-byte `copy_note` exceptions. Use `obsidian_destroy` only for explicit `delete_note`, `delete_folder`, `replace_note`, and `empty_trash` requests after destructive preview/approval.
- Omit `budget` for normal research; the default is generous. Use `budget: "tiny"` only for quick orientation and `budget: "standard"` for smaller responses.

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

```json
{ "mode": "relationships", "path": "Research/Integrated Gradients/index.md", "budget": "standard", "maxRelated": 10, "includeBacklinks": true }
```

Read-only operation plan preview:

```json
{
  "operations": [
    { "id": "create", "tool": "obsidian_write", "operation": "create", "path": "Projects/Plan.md", "content": "# Plan\n" },
    { "id": "relationships", "tool": "obsidian_retrieve", "operation": "relationships", "path": "Projects/Plan.md" }
  ],
  "budget": "standard"
}
```

Workflow-neutral validation of proposed content:

```json
{ "target": "proposed_content", "content": "# Plan\n\nSee [Roadmap](Roadmap.md).", "expectedPath": "Projects/Plan.md", "budget": "tiny" }
```

Explicit existing-note validation:

```json
{ "target": "existing_note", "path": "Projects/Plan.md", "budget": "standard" }
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

Explicit destructive preview:

```json
{ "operation": "delete_note", "path": "Archive/Old.md", "dryRun": true }
```

```json
{ "operation": "replace_note", "path": "Projects/Plan.md", "content": "# Replacement\n", "dryRun": true }
```
