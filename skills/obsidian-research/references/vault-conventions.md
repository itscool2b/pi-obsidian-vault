# Vault Conventions for Obsidian Research

## Notes and Paths

- Treat extension paths as vault-relative Markdown paths.
- Cite note paths exactly as returned by tools.
- Do not request absolute paths, hidden files, `.obsidian/`, or non-Markdown files.

## Search Conventions

- Search exact phrases first, then aliases, acronyms, tags, headings, dates, month names, project-progress terms, and related terms.
- Do not claim absence after one exact search.
- Use typo-tolerant search, but verify important claims by reading notes.
- Use `obsidian_vault_map`, `obsidian_detect_projects`, and `obsidian_discover_project_notes` before giving up on broad project topics.
- Use `obsidian_find_orphan_notes` for disconnected-note cleanup questions.
- Use `obsidian_similar_notes` for related-note or possible-duplicate questions.
- Use `obsidian_suggest_note_organization` for read-only suggestions about missing indexes, links, tags, aliases, logs, and roadmaps.

## Obsidian Signals

- Aliases may appear in frontmatter as `alias` or `aliases`.
- Tags may appear in frontmatter or as body hashtags.
- Headings often contain milestones, phases, months, or project status.
- Backlinks and outgoing links indicate project context.
- Index-like notes include `index.md`, `README.md`, `overview.md`, `roadmap.md`, `MOC.md`, and `map.md`.

## Reporting

When answering from notes, report:

- searches attempted;
- note paths read;
- any uncertainty or missing evidence;
- suggested follow-up searches if evidence is thin.

## Safe Writes

- Writes are disabled unless `OBSIDIAN_ALLOW_WRITE=true`.
- V3 organization suggestions are read-only suggestions and create or modify zero files.
- Use create-only workflows for new research notes.
- Use append-only workflows for project logs.
- Ask before creating missing logs or indexes.
- Never overwrite existing content through a high-level workflow.
