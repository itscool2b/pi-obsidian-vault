---
name: obsidian-research
description: Retrieve compact Obsidian vault context for research tasks through the single read-only obsidian_retrieve tool.
---

# Obsidian Research

Use `obsidian_retrieve` for all Obsidian vault retrieval.

## Workflow

1. Start with candidate discovery:
   - `mode: "search"` or `mode: "auto"`
   - Include a focused query, alias, tag, property, project phrase, or folder scope.
2. Review ranked candidates, paths, previews, scores, and match reasons.
3. Request deeper context only for specific returned paths:
   - `mode: "context"`
   - `selected: [{ "path": "..." }]`
4. Use `mode: "graph"` or `mode: "project"` for bounded relationship/project summaries.

## Safety rules

- Do not use or ask for legacy Obsidian read/search/list/write/open tools.
- Do not request full vault, full folder, or multi-note dumps.
- Treat write/open requests as out of scope; `obsidian_retrieve` is read-only.
- Prefer `budget: "tiny"` for quick orientation and `budget: "standard"` for normal research.

## Good examples

```json
{ "query": "integrated gradients", "mode": "search", "budget": "standard" }
```

```json
{ "mode": "context", "query": "implementation", "selected": [{ "path": "Research/Integrated Gradients/index.md" }] }
```
