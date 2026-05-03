# Changelog

All notable changes to `pi-obsidian-vault` will be documented in this file.

## [0.2.0] - 2026-05-03

Shipping release for the dead-simple vault path model, built-in human approval flow, session auto-write, and the new explicit destructive tool.

### Added

- `obsidian_destroy` for explicit destructive operations: `delete_note`, `delete_folder`, `replace_note`, and `empty_trash`, with separate destructive approval.
- `/obsidian-vault auto-destroy status|on|off` and session-local `Auto-destroy this session` state.

### Changed

- Simplified setup around one normal persistent setting: remembered `vaultPath`, with Obsidian Desktop auto-detection when nothing is remembered.
- Removed confirmation-token retry flow; mutation tools preview internally and ask for human approval inside Pi.
- Added session-local `Auto-write this session` for non-destructive mutations.

### Safety posture

- `dryRun: true` remains preview-only, including when auto-write or auto-destroy is enabled.
- Auto-write never authorizes `obsidian_destroy`; destructive approval is separate.
- No UI context returns destructive previews only unless auto-destroy is already enabled for the current session.

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

- `obsidian_config` for remembering, forgetting, and checking the single normal setting: the Obsidian vault folder path.
- Auto-detection from Obsidian Desktop known-vault metadata.
- `/obsidian-vault` simple status plus session controls for `auto-write`, `set-vault`, and `forget-vault`.
- `obsidian_retrieve` for candidate-first Obsidian retrieval with modes `auto`, `search`, `context`, `graph`, `project`, `note`, and `relationships`.
- Explicit note inspection through `obsidian_retrieve` `mode: "note"` for one safe vault-relative Markdown path.
- Bounded explicit-note relationship summaries through `obsidian_retrieve` `mode: "relationships"` with outgoing links, degraded backlink metadata when unavailable, and no broad backlink scan.
- `obsidian_validate` for read-only, workflow-neutral Markdown validation of one explicit existing note or one proposed content payload.
- `obsidian_plan` for read-only operation previews across existing public retrieve, validate, write, edit, and manage operations.
- `obsidian_write` for explicit safe Markdown `create`, `append`, and `create_folder` workflows with built-in approval.
- `obsidian_edit` for explicit safe structured edits: `replace_section`, `insert_under_heading`, `update_frontmatter`, `remove_frontmatter`, and `replace_exact_text`.
- `obsidian_manage` for explicit safe single-note `move_note`, recoverable `trash_note`, `restore_note`, and byte-for-byte `copy_note`.

### Safety posture

- Explicit safe vault-relative paths only for local note operations.
- Human approval before mutation by default.
- `dryRun: true` is always preview-only.
- Read-only tools never mutate.
- Redacted user-facing outputs.
- No broad vault dumps, broad folder dumps, broad filesystem discovery, broad backlink scans, or recursive graph crawling.
- No permanent delete, overwrite, suffixing, auto-renaming, destination inference, automatic link rewriting, destructive folder operations, recursive/wildcard/bulk operations, arbitrary CLI commands, shell/network behavior, or Obsidian UI-open behavior.

### Known limitations

- This is a Pi extension, not an Obsidian community plugin or GUI.
- If auto-detection fails, the user must provide the vault folder path once.
- Backlink metadata can degrade safely when the configured retrieval backend cannot provide targeted references.
- Real-vault checks are opt-in/manual only; committed smoke tests should use temporary or disposable vaults.

[0.2.0]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.2.0
[0.1.1]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.1.1
[0.1.0]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.1.0
