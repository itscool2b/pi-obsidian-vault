# Changelog

All notable changes to `pi-obsidian-vault` will be documented in this file.

## [0.2.3] - 2026-05-07

Patch release for deterministic Obsidian CLI setup guidance.

### Fixed

- Detects disabled/unregistered Obsidian CLI setup failures, including the real `Command line interface is not enabled` message that exits successfully.
- Returns deterministic setup guidance for CLI-backed retrieval and existing-note validation instead of misleading empty candidate results.
- Suppresses raw CLI setup noise such as `ENOENT`, spawn errors, stdout/stderr diagnostics, and local paths in user-facing setup responses.

### Changed

- Added focused CLI setup regression tests while preserving existing write/edit/manage/destroy/plan behavior.
- Added the Obsidian CLI prerequisite near the top of the README and in troubleshooting.

### Safety posture

- CLI setup UX only; no new mutation powers, broad scans, shell/network behavior, overwrite behavior, link rewriting, or destructive semantics.

## [0.2.2] - 2026-05-06

README polish patch for npm/pi.dev.

### Changed

- Reworked the README around the actual public tool surface, auto-detect-first setup, and centralized auto-open behavior.
- Simplified the package landing page while preserving accurate examples for retrieval, validation, planning, writing, editing, note management, and explicit destructive operations.
- Clarified vault resolution, session auto-open/auto-write/auto-destroy behavior, and safety limitations without changing extension behavior.

### Safety posture

- Documentation/package polish only; no extension behavior, public tools, mutation operations, app-readiness behavior, or safety semantics changed.

## [0.2.1] - 2026-05-04

Patch release for centralized Obsidian Desktop auto-open readiness and write-hang hardening.

### Added

- Central app-readiness preflight that can auto-open the configured/detected Obsidian vault for vault-touching tools.
- `/obsidian-vault auto-open status|on|off` session controls.
- Desktop launch controls through environment overrides such as `OBSIDIAN_AUTO_OPEN`, `OBSIDIAN_APP_PATH`, timeout settings, vault name, and safe vault URI.

### Changed

- Mutation tools now preview/validate first and only check/open Obsidian immediately before an actual commit.
- Registered-tool no-UI `dryRun:false` non-destructive calls now return previews instead of committing without approval.
- Centralized registered-tool retrieval/validation launch behavior instead of relying on legacy CLI auto-launch.

### Fixed

- Prevented write hangs from preflight running before dry-run previews or validation failures.
- Added hard timeout settling for spawned commands and app preflight runner calls.
- Added approval timeout/abort handling; timeout is treated as cancellation.
- Removed raw path echoing from app preflight setup failures.
- Replaced brittle Windows/WSL `cmd.exe /c start` launch path with `explorer.exe`, removed URI-less Linux fallback, and added basic WSL `/mnt/<drive>` path conversion.

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

[0.2.3]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.2.3
[0.2.2]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.2.2
[0.2.1]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.2.1
[0.2.0]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.2.0
[0.1.1]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.1.1
[0.1.0]: https://github.com/itscool2b/pi-obsidian-vault/releases/tag/v0.1.0
