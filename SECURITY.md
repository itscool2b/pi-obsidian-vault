# Security Policy

`pi-obsidian-vault` is designed for agent-safe Obsidian vault access from Pi. Its security model is based on narrow public tools, auto-detected or remembered vault roots, safe vault-relative targets, human approval before mutations, bounded read-only retrieval, and redacted outputs.

## Supported version

| Package | Version |
| --- | --- |
| `pi-obsidian-vault` | `0.2.0` |

## Security model

### One normal setting

The only normal persistent setting is the remembered Obsidian vault folder path. If auto-detection fails, the user can tell the agent the vault path and the agent can save it through `obsidian_config` or `/obsidian-vault set-vault <path>`.

Other behavior is hardcoded: safety rails are not configurable and cannot be relaxed by config.

### Safe local operations

Local mutations require safe vault-relative targets. Note operations accept Markdown note paths such as `Projects/Roadmap.md`; folder creation accepts a safe vault-relative folder path. `obsidian_write create` may infer a safe Markdown path from a supplied title/content when no path is supplied.

The extension refuses absolute targets, traversal, hidden paths, `.obsidian` paths, wildcard-looking paths, recursive-looking paths, bulk/list-looking paths, and unsupported non-Markdown note targets.

### Human-in-the-loop mutation model

Mutation tools are one-call interactive tools:

- `obsidian_write` previews create, append, and create_folder before committing.
- `obsidian_edit` previews structured edits to existing notes before committing.
- `obsidian_manage` previews single-note move, recoverable trash, restore, and copy before committing.
- `obsidian_destroy` previews explicit permanent note deletion, recursive folder deletion, full-note replacement, and empty_trash before committing.

In interactive Pi sessions, these tools open an approval dialog and commit only when the human approves. Non-destructive mutation dialogs include `Auto-write this session`, which approves the current change and remembers the choice only in memory for the current Pi session. Auto-write still runs internal preview/safety checks before each commit and resets on a new session or when `/obsidian-vault auto-write off` is run.

`dryRun: true` is preview-only and does not mutate, reserve paths, stage commits, batch operations, or transactionally apply changes, even when auto-write or auto-destroy is enabled.

`obsidian_destroy` has separate destructive approval (`Yes, destroy` / `No` / `Auto-destroy this session`). Auto-write never authorizes destructive operations. Without an interactive approval UI, destructive tool calls return previews only unless `Auto-destroy this session` was explicitly enabled earlier in the same Pi session.

### Read-only tools

These tools are read-only:

- `obsidian_retrieve`
- `obsidian_validate`
- `obsidian_plan`

They do not write, append, edit, move, trash, restore, copy, delete, destroy, rewrite links, create templates, open Obsidian UI, execute arbitrary commands, or perform user-requested shell/network actions.

### No broad scans or dumps

Retrieval is candidate-first and budgeted. Explicit note inspection and relationship summaries require one explicit safe vault-relative Markdown path. Relationship retrieval reads only that note plus targeted safe backlink metadata when available; it does not perform broad vault scans, broad vault dumps, broad folder dumps, broad backlink scans, recursive graph crawling, or full-vault listing.

### Unsupported destructive or broad behavior

The extension does not support:

- Permanent delete outside explicit `obsidian_destroy delete_note/delete_folder/empty_trash`.
- Full-note overwrite outside explicit `obsidian_destroy replace_note`.
- Destructive folder operations outside explicit `obsidian_destroy delete_folder`.
- Wildcard or bulk operations. Recursive deletion is supported only for one explicit `obsidian_destroy delete_folder` target after destructive approval.
- Folder move/trash/restore/copy operations.
- Non-Markdown note management operations.
- Suffixing, auto-renaming, or inferred destructive targets.
- Automatic link rewriting or backlinks mutation.
- Templates or template registries.
- Batch execution, staged commits, or transaction commits.
- GUI, Obsidian pane UI, Obsidian community plugin UI, or UI-open commands.
- Arbitrary CLI commands.

### Shell and network posture

The extension does not provide shell or network tools. Retrieval uses the Obsidian CLI adapter as a controlled CLI adapter and controlled backend. CLI invocation is constrained to retrieval/status behavior and is not exposed as arbitrary command execution.

### Redaction policy

Tool responses, status output, warnings, errors, examples, and user-facing docs must not expose:

- Vault roots.
- Absolute local note/source/destination/trash paths.
- Absolute CLI paths.
- Secrets.
- Lock keys.
- Shell details.
- Network details.
- Stack traces or arbitrary local filesystem details.

Vault-relative paths such as `Projects/Roadmap.md` are allowed because they are explicit safe targets users provide.

### Temporary/disposable smoke tests

Committed smoke tests must use temporary or disposable vaults only. Real-vault checks must be opt-in/manual only. Release docs must not instruct maintainers or users to run destructive or committed tests against a real vault by default. Smoke coverage must preserve no-overwrite, human approval/auto-write session behavior, destructive approval/auto-destroy separation, redaction, no-shell/network, and no-broad-scan guarantees.

## Reporting security issues

Please report security-sensitive issues privately if you can reach the maintainer directly. If no private channel is available, open a GitHub issue at <https://github.com/itscool2b/pi-obsidian-vault/issues> with a minimal description and **do not include** private vault contents, secrets, absolute local paths, or other sensitive local details.

Useful reports include:

- A safety boundary that appears weakened.
- Any vault-root or absolute-path leak in user-facing output.
- A read-only tool causing mutation.
- A mutation committing without a safe target, required human approval, or required destructive approval.
- Broad scan/dump behavior that is not explicitly requested by a bounded safe mode.

## Maintainer release checks

Before publishing, run the release checklist in [RELEASE.md](./RELEASE.md), including `npm run check`, focused safety tests, redaction checks, side-effect refusal checks, no-shell-network checks, and `npm pack --dry-run` package contents inspection.
