---
name: obsidian-research
description: Retrieve compact Obsidian vault context for research tasks through the read-only obsidian_retrieve tool. Safe writing is handled separately by obsidian_write.
---

# Obsidian Research

Use `obsidian_retrieve` for all Obsidian vault retrieval.

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
