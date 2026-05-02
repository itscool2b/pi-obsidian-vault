---
name: obsidian-research
description: Retrieve compact Obsidian vault context and bounded explicit-note relationships through obsidian_retrieve, preview operation plans through obsidian_plan, and validate Markdown safely through obsidian_validate. Safe Markdown create/append and folder creation are handled separately by obsidian_write, safe structured edits by obsidian_edit, and safe single-note moves/renames/trash/restores/copies by obsidian_manage.
---

# Obsidian Research

Use `obsidian_retrieve` for all Obsidian vault retrieval, including `mode: "relationships"` for one explicit safe Markdown note path. Use `obsidian_plan` for read-only bounded preview of explicit operation sequences before individual dry-runs; it never executes or commits. Use `obsidian_validate` for read-only workflow-neutral Markdown validation of one explicit existing note or explicit proposed content. Use `obsidian_write` only for explicit Markdown create/append or safe folder creation requests, use `obsidian_edit` only for explicit structured edits to existing Markdown notes, and use `obsidian_manage` only for explicit safe single-note move/rename, recoverable trash, restore-from-trash, or byte-for-byte copy requests.

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
8. Use `obsidian_plan` to preview a bounded sequence of explicit planned operations, detect conflicts/order hazards, and summarize virtual effects. Treat it as read-only advisory output; never use it as batch execution.
9. Only after retrieval/context/inspection/relationship/validation/plan preview confirms the user's intent, route explicit mutations to `obsidian_write`, `obsidian_edit`, or `obsidian_manage` with user-supplied safe vault-relative paths; never infer mutation targets from search results alone.
10. Preview mutations first with omitted `dryRun` or `dryRun: true`. If a dry-run returns `confirmationToken`, commit only by repeating the exact confirmed request with `dryRun: false` and that token; missing, malformed, expired, mismatched, unavailable, unverifiable, unsupported-version, or revoked-if-ever-encountered token states fail closed before mutation.
11. Use `mode: "graph"` or `mode: "project"` for bounded query-centered relationship/project summaries; use `mode: "relationships"` for explicit-note relationship summaries.

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
- Never use `obsidian_validate` for templates, template variables, path generation, automatic folder creation, backlinks, relationship summaries, transaction previews, commit tokens, link rewriting, broad vault access, shell/network calls, UI open behavior, or arbitrary CLI execution.
- Use `obsidian_plan` only for read-only previews of explicit planned operations. It may mirror retrieve note, retrieve.relationships, validate existing/proposed content, write create/append/create_folder, edit replace_section/insert_under_heading/update_frontmatter/remove_frontmatter/replace_exact_text, and manage move_note/trash_note/restore_note/copy_note. It never executes, commits, stages, batches, transactionally applies, reserves paths, creates locks, creates commit tokens, rewrites links, scans broadly, shells out, uses network, opens UI, or generates destinations.
- If `obsidian_plan` returns `valid:false`, revise the plan. If it returns `valid:true`, ask for individual existing-tool dry-runs before any commit. `dryRun:false` inside a planned operation is warning-only and ignored by `obsidian_plan`.
- For explicit safe Markdown create/append requests, use the separate `obsidian_write` tool with `dryRun` preview first. Do not route writes through retrieval.
- For explicit safe folder creation requests, use `obsidian_write` with `operation: "create_folder"`, an explicit vault-relative folder path, and `dryRun` preview first. Omit `content`; if content is supplied, it is rejected with `CONTENT_NOT_ALLOWED` and no file is created or modified.
- For explicit safe existing-note structured edit requests, use the separate `obsidian_edit` tool with `dryRun` preview first. Do not route edits through retrieval or `obsidian_write`. By default, `replace_section` and `replace_exact_text` commits require the matching dry-run-issued `confirmationToken`.
- For explicit safe single-note move/rename requests, use the separate `obsidian_manage` tool with `operation: "move_note"`, explicit safe vault-relative Markdown `fromPath` and `toPath`, and `dryRun` preview first. Do not route moves through retrieval, `obsidian_write`, or `obsidian_edit`. Include the matching `confirmationToken` on token-required commits. Review any dry-run `linkImpact` metadata; it is advisory and links are not rewritten automatically.
- For explicit safe recoverable single-note trash requests, use the separate `obsidian_manage` tool with `operation: "trash_note"`, explicit safe vault-relative Markdown `path`, optional explicit safe vault-relative `trashFolder`, and `dryRun` preview first. If `trashFolder` is omitted it defaults to `_Trash`. Include the matching `confirmationToken` on token-required commits. Review any dry-run `linkImpact` metadata; inbound links may be affected when backlink data is unavailable. Do not route trash through retrieval, `obsidian_write`, or `obsidian_edit`.
- For explicit safe single-note restore requests, use the separate `obsidian_manage` tool with `operation: "restore_note"`, explicit safe vault-relative Markdown `trashPath` inside the selected/default `trashFolder`, explicit safe vault-relative Markdown `toPath`, optional explicit safe `trashFolder`, and `dryRun` preview first. If `trashFolder` is omitted it defaults to `_Trash`. Include the matching `confirmationToken` on token-required commits. Do not infer restore sources from search, titles, aliases, metadata, or trash folder contents.
- For explicit safe single-note copy requests, use the separate `obsidian_manage` tool with `operation: "copy_note"`, explicit safe vault-relative Markdown `fromPath` and `toPath`, and `dryRun` preview first. `copy_note` copies exactly one regular Markdown note byte-for-byte while leaving the source unchanged. Include the matching `confirmationToken` on token-required commits. Review any dry-run `linkImpact` metadata; copied content links are preserved exactly and not rewritten. Do not route copies through retrieval, `obsidian_write`, or `obsidian_edit`; do not infer copy sources or destinations from search results.
- `obsidian_edit` supports only `replace_section`, `insert_under_heading`, `update_frontmatter`, `remove_frontmatter`, and `replace_exact_text` on explicit safe vault-relative Markdown paths to existing notes.
- Use exact ATX Markdown headings for section edits, e.g. `## Plan`; duplicate or missing headings must be reported to the user instead of guessed.
- Use frontmatter edits only for top-of-file YAML properties; `update_frontmatter` may create frontmatter, while `remove_frontmatter` requires the property to exist.
- Use `replace_exact_text` only when the user provides an explicit existing note path, non-empty `oldText`, and explicit `newText`; preview first, require exactly one literal match, and report missing or duplicate matches instead of guessing.
- `obsidian_manage move_note` requires the source to exist, destination to be absent, destination parent folder to already exist, and missing destination parents return `status=not_found` with `error.code=PARENT_MISSING`.
- `obsidian_manage trash_note` is recoverable move-to-trash, not permanent deletion. It requires the source note to exist, creates the safe trash folder only when committed with `dryRun:false`, and returns `status=conflict` with `error.code=TRASH_TARGET_EXISTS` if the computed final trash path already exists; do not suffix, auto-rename, overwrite, or search for alternatives.
- `obsidian_manage restore_note` is a recoverable move out of trash, not a search or bulk recovery tool. It requires `trashPath` inside the selected/default `trashFolder`, `toPath` whose parent folder already exists, and returns deterministic errors such as `TRASH_PATH_OUTSIDE_TRASH`, `TRASH_SOURCE_NOT_FOUND`, `TARGET_EXISTS`, `PARENT_MISSING`, `TRASH_SOURCE_IS_FOLDER`, `TRASH_SOURCE_NOT_FILE`, `TRASH_SOURCE_NOT_MARKDOWN`, `TARGET_NOT_MARKDOWN`, and `SAME_PATH` without mutation.
- `obsidian_manage copy_note` requires the source to exist as one regular Markdown note, destination to be absent, destination parent folder to already exist, and distinct normalized paths. It returns deterministic errors such as `SOURCE_NOT_FOUND`, `SOURCE_IS_FOLDER`, `SOURCE_NOT_FILE`, `SOURCE_NOT_MARKDOWN`, `TARGET_NOT_MARKDOWN`, `SAME_PATH`, `TARGET_EXISTS`, `PARENT_MISSING`, and `PARENT_NOT_FOLDER` without partial mutation.
- `obsidian_write` create/append dry-run previews may include advisory validation metadata for supplied content; warning/info issues do not block commits, and append validation checks only the supplied appended content in this batch. By default write create/create_folder/append remain token-free; strict token mode requires tokens for all committed write/edit/manage mutations.
- Confirmation tokens are not one-time-use in this batch, revocation lists are not implemented, and tokens expire by TTL or after extension process restart. Token-required commits must never silently bypass verification; unavailable token service/secret state fails closed before mutation.
- Never use any Obsidian tool for full-note overwrite, permanent delete, folder delete, recursive delete/restore/copy, wildcard delete/restore/copy, bulk delete/restore/copy, non-Markdown delete/restore/copy, folder moves/restores/copies, destructive folder management, UI open, shell execution, network calls, broad scanning, filesystem discovery, regex/fuzzy/semantic replacement, inferred target text, link rewriting, overwrite-copy, templates, broad backlinks, transaction previews, batch execution, arbitrary token generation outside dry-run previews, or arbitrary CLI commands. Use `obsidian_manage` only for the explicit single-note `move_note`, recoverable `trash_note`, explicit `restore_note`, and explicit byte-for-byte `copy_note` exceptions.
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
