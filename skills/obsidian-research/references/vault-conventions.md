# Vault Conventions for Obsidian Research

## Notes and Paths

- Treat extension paths as vault-relative Markdown paths.
- Cite note paths exactly as returned by tools.
- Do not request absolute paths, hidden files, `.obsidian/`, or non-Markdown files.

## Search Conventions

- Search exact phrases first, then aliases, acronyms, tags, headings, dates, month names, project-progress terms, and related terms.
- Do not claim absence after one exact search.
- Use `obsidian_retrieve` candidate discovery before asking for selected context.
- Use `mode: "relationships"` only for one explicit safe Markdown note path.

## Obsidian Signals

- Aliases may appear in frontmatter as `alias` or `aliases`.
- Tags may appear in frontmatter or as body hashtags.
- Headings often contain milestones, phases, months, or project status.
- Backlinks and outgoing links indicate project context when safely available.
- Index-like notes include `index.md`, `README.md`, `overview.md`, `roadmap.md`, `MOC.md`, and `map.md`.

## Reporting

When answering from notes, report:

- searches attempted;
- note paths read;
- any uncertainty or missing evidence;
- suggested follow-up searches if evidence is thin.

## Safe Mutations

- For normal changes, use `obsidian_write`, `obsidian_edit`, or `obsidian_manage` and omit `dryRun`; the extension previews internally and asks for approval.
- `Auto-write this session` can skip prompts for the current session, but internal preview/safety checks still run.
- For explicit destructive requests only, use `obsidian_destroy`; it uses separate destructive approval and `Auto-destroy this session`.
- Use create-only workflows for new research notes.
- Use append-only workflows for project logs.
- Never overwrite existing content through normal high-level workflows; full-note replacement belongs only in explicit `obsidian_destroy replace_note` requests.
