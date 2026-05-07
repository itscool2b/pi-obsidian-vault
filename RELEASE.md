# Release Checklist: pi-obsidian-vault 0.2.3

This checklist is the public-release gate for `pi-obsidian-vault` `0.2.3`.

## Package identity

- Package name: `pi-obsidian-vault`
- Version: `0.2.3`
- License: `MIT` (`LICENSE`)
- Repository: <https://github.com/itscool2b/pi-obsidian-vault>
- Exact Pi install command: `pi install npm:pi-obsidian-vault`
- Exact npm publish command: `npm publish`
- Release branch: `main`

## Public surface inventory

The release ships one Pi extension entrypoint:

- `./src/index.ts`

The extension registers these public tools and command:

- `obsidian_config`
- `obsidian_retrieve`
- `obsidian_validate`
- `obsidian_plan`
- `obsidian_write`
- `obsidian_edit`
- `obsidian_manage`
- `obsidian_destroy`
- `/obsidian-vault`

The release intentionally ships the skill:

- `./skills/obsidian-research`

## Config inventory

The user-facing model has one normal persistent setting:

- remembered `vaultPath`

The agent can save it through `obsidian_config` or the user can run `/obsidian-vault set-vault <path>`. If no path is remembered, the extension tries Obsidian Desktop auto-detection.

Prerequisite: Obsidian Desktop's CLI must be enabled and registered for PATH for CLI-backed retrieval and existing-note validation. Setup failures should return deterministic guidance instead of raw CLI output.

Everything else is hardcoded sane defaults and cannot enable unsafe powers, broad scans, accidental overwrite, link rewriting, unsafe path handling, arbitrary CLI commands, shell/network behavior, or arbitrary UI-open behavior. Auto-open is limited to centralized app-readiness preflight for the configured/detected vault. Explicit permanent deletion/full-note replacement is available only through `obsidian_destroy` with separate destructive approval.

## Intended package contents

The `package.json` `files` whitelist includes:

- `src/`
- `skills/`
- `assets/`
- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `SECURITY.md`
- `RELEASE.md`
- `package.json` (always included by npm)

## Intentionally excluded from the npm package

- `specs/`
- `.specify/`
- `tests/`
- `node_modules/`
- Coverage output
- Logs
- Local vault data
- Local config files
- Secrets
- Editor/system artifacts
- Generated temporary files

## Verification command matrix

Run from the repo root before publishing:

| Check | Command |
| --- | --- |
| Full quality gate | `npm run check` |
| TypeScript check | `npm run typecheck` |
| Full test suite | `npm test` |
| Release docs/smoke focused check | `npm test -- docs-release-guidance release-hardening-smoke` |
| Tool surface | `npm test -- tool-surface` |
| Status capabilities | `npm test -- status-capabilities` |
| No shell/network expansion | `npm test -- no-shell-network` |
| Side-effect refusal | `npm test -- side-effect-refusal` |
| Redaction regression | `npm test -- redaction-regression` |
| Retrieve contract | `npm test -- retrieve-contract` |
| Write contract | `npm test -- write-contract` |
| Edit contract | `npm test -- edit-contract` |
| Manage contract | `npm test -- manage-contract` |
| Destroy contract | `npm test -- destroy-contract` |
| Validation tool | `npm test -- validation-tool` |
| Validation path safety | `npm test -- validation-path-safety` |
| Plan preview | `npm test -- plan-preview` |
| Plan request validation | `npm test -- plan-request-validation` |
| Plan path safety | `npm test -- plan-path-safety` |
| Plan conflicts | `npm test -- plan-conflicts` |
| Plan output ordering | `npm test -- plan-output-ordering` |
| Plan no mutation | `npm test -- plan-no-mutation` |
| Package dry run | `npm pack --dry-run` |
| Package dry run JSON | `npm pack --dry-run --json` |

## Smoke-test safety requirements

Committed smoke tests use temporary or disposable vaults only. Real-vault smoke checks are opt-in/manual only. Release docs do not instruct users or maintainers to run destructive or committed tests against a real vault by default.

Smoke coverage preserves these guarantees:

- No overwrite.
- Human approval before mutation by default.
- Session auto-write still performs internal preview/safety checks.
- Session auto-destroy is separate from auto-write and still performs internal preview/safety checks.
- `dryRun: true` never commits.
- Redacted output.
- No shell/network expansion.
- No broad vault scan, broad folder dump, broad backlink scan, or broad relationship crawl.

## Final publish commands

```bash
npm run check
npm pack --dry-run
npm publish
```

Then verify installation with:

```bash
pi install npm:pi-obsidian-vault
```
