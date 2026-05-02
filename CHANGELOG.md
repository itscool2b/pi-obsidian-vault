# Changelog

All notable changes to `pi-obsidian-vault` will be documented in this file.

## [0.1.1] - 2026-05-02

Package-page polish patch for GitHub, npm, and pi.dev.

### Changed

- Added the README hero image at `assets/pi-obsidian-vault-cover.png`.
- Included `assets/` in the npm package files whitelist so the README image ships with the package.
- Cleaned the README opening and structure while preserving the existing public tool surface, examples, safety posture, and install guidance.

### Safety posture

- Documentation/package polish only; no extension behavior, public tools, mutation operations, or safety semantics changed.

## [0.1.0] - 2026-05-02

Initial public release for npm/pi.dev.

### Added

- `obsidian_retrieve` for candidate-first Obsidian retrieval with modes `auto`, `search`, `context`, `graph`, `project`, `note`, and `relationships`.
- Explicit note inspection through `obsidian_retrieve` `mode: "note"` for one safe vault-relative Markdown path.
- Bounded explicit-note relationship summaries through `obsidian_retrieve` `mode: "relationships"` with outgoing links, degraded backlink metadata when unavailable, and no broad backlink scan.
- `obsidian_validate` for read-only, workflow-neutral Markdown validation of one explicit existing note or one proposed content payload.
- `obsidian_plan` for read-only operation previews across existing public retrieve, validate, write, edit, and manage operations.
- `obsidian_write` for explicit safe Markdown `create`, `append`, and `create_folder` dry-run-first workflows.
- `obsidian_edit` for explicit safe structured edits: `replace_section`, `insert_under_heading`, `update_frontmatter`, `remove_frontmatter`, and `replace_exact_text`.
- `obsidian_manage` for explicit safe single-note `move_note`, recoverable `trash_note`, `restore_note`, and byte-for-byte `copy_note`.
- `/obsidian-vault` status command with redacted retrieve/write/edit/manage/plan/token/config capability output.
- Commit-token safety for risky dry-run-first commits, including default token requirements for risky edits and manage operations and strict mode for all existing mutations.
- Config polish for retrieval budgets, relationship budgets, preview limits, validation issue caps, default trash folder, commit-token policy, and advisory write/append validation toggles.
- Package-page README, security documentation, release checklist, and package contents verification guidance.

### Safety posture

- Explicit safe vault-relative paths only for local note operations.
- Dry-run-first mutations.
- Commit-token protection for token-required commits.
- Read-only tools never mutate.
- Redacted user-facing outputs.
- No broad vault dumps, broad folder dumps, broad filesystem discovery, broad backlink scans, or recursive graph crawling.
- No permanent delete, overwrite, suffixing, auto-renaming, destination inference, automatic link rewriting, destructive folder operations, recursive/wildcard/bulk operations, arbitrary CLI commands, shell/network behavior, or Obsidian UI-open behavior.

### Known limitations

- This is a Pi extension, not an Obsidian community plugin or GUI.
- Local write/edit/manage requires a configured local `vaultPath`.
- Backlink metadata can degrade safely when the configured retrieval backend cannot provide targeted references.
- Commit tokens are process-local safety confirmations, not long-lived approvals; they expire by TTL or process restart and are not one-time-use in this release.
- Real-vault checks are opt-in/manual only; committed smoke tests should use temporary or disposable vaults.

[0.1.1]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.1.1
[0.1.0]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.1.0
