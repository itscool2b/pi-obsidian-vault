---
name: obsidian-research
description: Retrieve compact Obsidian vault context for research tasks through the read-only obsidian_retrieve tool. Safe Markdown create/append and folder creation are handled separately by obsidian_write, safe structured edits by obsidian_edit, and safe single-note moves/renames by obsidian_manage.
---

# Obsidian Research

Use `obsidian_retrieve` for all Obsidian vault retrieval. Use `obsidian_write` only for explicit Markdown create/append or safe folder creation requests, use `obsidian_edit` only for explicit structured edits to existing Markdown notes, and use `obsidian_manage` only for explicit safe single-note move/rename requests.

## Workflow

1. Start with candidate discovery:
   - Supported top-level fields are exactly `query`, `mode`, `selected`, `scope`, `budget`, `maxCandidates`, and `explain`.
   - Valid `mode` values are `auto`, `search`, `context`, `graph`, and `project`.
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
5. Use `mode: "graph"` or `mode: "project"` for bounded relationship/project summaries.

## Safety rules

- Do not use or ask for legacy Obsidian read/search/list/write/open tools.
- Do not request full vault, full folder, or multi-note dumps.
- If `agentGuidance.resultState` is `ambiguous` or `no_match`, clarify/refine instead of broadening context.
- Treat write/open intent as out of scope for retrieval; `obsidian_retrieve` is read-only.
- For explicit safe Markdown create/append requests, use the separate `obsidian_write` tool with `dryRun` preview first. Do not route writes through retrieval.
- For explicit safe folder creation requests, use `obsidian_write` with `operation: "create_folder"`, an explicit vault-relative folder path, and `dryRun` preview first. Omit `content`; if content is supplied, it is rejected with `CONTENT_NOT_ALLOWED` and no file is created or modified.
- For explicit safe existing-note structured edit requests, use the separate `obsidian_edit` tool with `dryRun` preview first. Do not route edits through retrieval or `obsidian_write`.
- For explicit safe single-note move/rename requests, use the separate `obsidian_manage` tool with `operation: "move_note"`, explicit safe vault-relative Markdown `fromPath` and `toPath`, and `dryRun` preview first. Do not route moves through retrieval, `obsidian_write`, or `obsidian_edit`.
- `obsidian_edit` supports only `replace_section`, `insert_under_heading`, `update_frontmatter`, `remove_frontmatter`, and `replace_exact_text` on explicit safe vault-relative Markdown paths to existing notes.
- Use exact ATX Markdown headings for section edits, e.g. `## Plan`; duplicate or missing headings must be reported to the user instead of guessed.
- Use frontmatter edits only for top-of-file YAML properties; `update_frontmatter` may create frontmatter, while `remove_frontmatter` requires the property to exist.
- Use `replace_exact_text` only when the user provides an explicit existing note path, non-empty `oldText`, and explicit `newText`; preview first, require exactly one literal match, and report missing or duplicate matches instead of guessing.
- `obsidian_manage` supports only `move_note`. Source must exist, destination must not exist, destination parent folder must already exist, and missing destination parents return `status=not_found` with `error.code=PARENT_MISSING`.
- Never use any Obsidian tool for full-note overwrite, delete, copy, folder moves, destructive folder management, UI open, shell execution, network calls, broad scanning, filesystem discovery, regex/fuzzy/semantic replacement, inferred target text, link rewriting, or arbitrary CLI commands. Use `obsidian_manage` only for the explicit single-note `move_note` exception.
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
