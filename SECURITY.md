# Security Policy

`pi-obsidian-vault` is designed for agent-safe Obsidian vault access from Pi. Its security model is based on narrow public tools, explicit vault-relative paths, dry-run-first mutations, commit-token safety, bounded read-only retrieval, and redacted outputs.

## Supported version

| Package | Version |
| --- | --- |
| `pi-obsidian-vault` | `0.1.1` |

## Security model

### Explicit-path-only local operations

Local mutations require explicit safe vault-relative paths. Note operations accept Markdown note paths such as `Projects/Roadmap.md`; folder creation accepts an explicit safe vault-relative folder path. The extension refuses absolute paths, traversal, hidden paths, `.obsidian` paths, wildcard-looking paths, recursive-looking paths, bulk/list-looking paths, and unsupported non-Markdown note targets.

The extension does not infer mutation destinations from titles, aliases, search results, folders, tags, backlinks, or relationship output.

### Dry-run-first mutation model

Mutation tools default to dry-run preview unless `dryRun:false` is explicit:

- `obsidian_write` previews create, append, and create_folder.
- `obsidian_edit` previews structured edits to existing notes.
- `obsidian_manage` previews single-note move, recoverable trash, restore, and copy.

Dry-runs do not reserve paths, stage commits, batch operations, transactionally apply changes, or mutate vault files.

### Commit-token behavior

Risky committed mutations can require a `confirmationToken` returned by a matching dry-run preview. Token-required commits verify the token before mutation and fail closed if the token is missing, malformed, expired, mismatched, unsupported-version, unavailable, unverifiable, or revoked-if-ever-encountered.

Tokens are process-local safety confirmations. They are bounded by policy, TTL, and extension process lifetime. They are not stable credentials and are not reusable forever.

### Read-only tools

These tools are read-only:

- `obsidian_retrieve`
- `obsidian_validate`
- `obsidian_plan`

They do not write, append, edit, move, trash, restore, copy, delete, rewrite links, create templates, open Obsidian UI, execute arbitrary commands, or perform user-requested shell/network actions.

### No broad scans or dumps

Retrieval is candidate-first and budgeted. Explicit note inspection and relationship summaries require one explicit safe vault-relative Markdown path. Relationship retrieval reads only that note plus targeted safe backlink metadata when available; it does not perform broad vault scans, broad folder dumps, broad backlink scans, recursive graph crawling, or full-vault listing.

### Unsupported destructive or broad behavior

The extension does not support:

- Permanent delete.
- Overwrite.
- Destructive folder operations.
- Recursive, wildcard, or bulk operations.
- Folder move/trash/restore/copy operations.
- Non-Markdown note management operations.
- Suffixing, auto-renaming, destination inference, or auto path generation.
- Automatic link rewriting or backlinks mutation.
- Templates or template registries.
- Batch execution, staged commits, or transaction commits.
- GUI, Obsidian pane UI, Obsidian community plugin UI, or UI-open commands.
- Arbitrary CLI commands.

### Shell and network posture

The extension does not provide shell or network tools. Retrieval uses the configured Obsidian CLI adapter as a controlled CLI adapter and controlled backend. CLI invocation is constrained to the extension's retrieval/status behavior and is not exposed as arbitrary command execution.

### Redaction policy

Tool responses, status output, warnings, errors, examples, and user-facing docs must not expose:

- Vault roots.
- Absolute local note/source/destination/trash paths.
- Absolute CLI paths.
- Secrets.
- Confirmation token internals or signing material.
- Lock keys.
- Shell details.
- Network details.
- Stack traces or arbitrary local filesystem details.

Vault-relative paths such as `Projects/Roadmap.md` are allowed because they are the explicit safe targets users provide.

### Temporary/disposable smoke tests

Committed smoke tests must use temporary or disposable vaults only. Real-vault checks must be opt-in/manual only. Release docs must not instruct maintainers or users to run destructive or committed tests against a real vault by default. Smoke coverage must preserve no-overwrite, dry-run-first, token, redaction, no-shell/network, and no-broad-scan guarantees.

## Reporting security issues

Please report security-sensitive issues privately if you can reach the maintainer directly. If no private channel is available, open a GitHub issue at <https://github.com/itscool2b/pi-obsidian-vault/issues> with a minimal description and **do not include** private vault contents, secrets, confirmation tokens, absolute local paths, or other sensitive local details.

Useful reports include:

- A safety boundary that appears weakened.
- Any vault-root or absolute-path leak in user-facing output.
- A read-only tool causing mutation.
- A mutation committing without explicit path, dry-run confirmation, or required token.
- Broad scan/dump behavior that is not explicitly requested by a bounded safe mode.

## Maintainer release checks

Before publishing, run the release checklist in [RELEASE.md](./RELEASE.md), including `npm run check`, focused safety tests, redaction checks, side-effect refusal checks, no-shell-network checks, and `npm pack --dry-run` package contents inspection.
