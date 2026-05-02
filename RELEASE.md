# Release Checklist: pi-obsidian-vault 0.1.1

This checklist is the public-release gate for `pi-obsidian-vault` `0.1.1`.

## Package identity

- Package name: `pi-obsidian-vault`
- Version: `0.1.1`
- License: `MIT` (`LICENSE`)
- Repository: <https://github.com/itscool2b/pi-obsidian-vault>
- Exact Pi install command: `pi install npm:pi-obsidian-vault`
- Exact npm publish command: `npm publish`
- Release branch: `main`

If the package is scoped before publication, update `package.json`, `README.md`, `CHANGELOG.md`, this file, and the final implementation report before publishing.

## Public surface inventory

The release ships one Pi extension entrypoint:

- `./src/index.ts`

The extension registers these public tools and command only:

- `obsidian_retrieve`
- `obsidian_validate`
- `obsidian_plan`
- `obsidian_write`
- `obsidian_edit`
- `obsidian_manage`
- `/obsidian-vault`

The release intentionally ships the skill:

- `./skills/obsidian-research`

No new public tools or mutation operations are part of this release-hardening batch.

## Config inventory

Supported config file:

- `~/.pi/agent/obsidian-vault.json`

Documented config fields:

- `vaultPath`
- `cliPath`
- `defaultRetrieveBudget`
- `defaultRelationshipBudget`
- `maxPreviewChars`
- `maxValidationIssues`
- `defaultTrashFolder`
- `commitTokensRequired`
- `commitTokenTtlSeconds`
- `commitTokenStrictMode`
- `writeDryRunValidationEnabled`
- `appendDryRunValidationEnabled`

Canonical environment variables:

- `OBSIDIAN_VAULT_PATH`
- `OBSIDIAN_CLI_PATH`
- `OBSIDIAN_RETRIEVE_DEFAULT_BUDGET`
- `OBSIDIAN_RELATIONSHIP_DEFAULT_BUDGET`
- `OBSIDIAN_MAX_PREVIEW_CHARS`
- `OBSIDIAN_VALIDATE_MAX_ISSUES`
- `OBSIDIAN_TRASH_FOLDER`
- `OBSIDIAN_COMMIT_TOKENS_REQUIRED`
- `OBSIDIAN_COMMIT_TOKEN_TTL_SECONDS`
- `OBSIDIAN_COMMIT_TOKEN_STRICT_MODE`
- `OBSIDIAN_WRITE_DRY_RUN_VALIDATION_ENABLED`
- `OBSIDIAN_APPEND_DRY_RUN_VALIDATION_ENABLED`

Config cannot enable unsafe powers, broad scans, overwrite, link rewriting, unsafe path handling, arbitrary CLI commands, shell/network behavior, or UI-open behavior. Tool and status output redact vault roots and local absolute paths.

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

`package-lock.json` is not required in the packed artifact and is not included by the current dry run.

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

All commands below were run from `/home/itscool2b/obsidian-extention-pi` on 2026-05-02.

| Check | Command | Result |
| --- | --- | --- |
| TypeScript check | `npm run typecheck` | PASS |
| Full test suite | `npm test` | PASS — 85 files passed, 1 skipped; 347 tests passed, 2 skipped |
| Full quality gate | `npm run check` | PASS — typecheck plus full test suite |
| Release docs/smoke focused check | `npm test -- docs-release-guidance release-hardening-smoke` | PASS — 2 files, 11 tests |
| Tool surface | `npm test -- tool-surface` | PASS — 1 file, 12 tests |
| Status capabilities | `npm test -- status-capabilities` | PASS — 1 file, 4 tests |
| No shell/network expansion | `npm test -- no-shell-network` | PASS — 1 file, 2 tests |
| Side-effect refusal | `npm test -- side-effect-refusal` | PASS — 1 file, 6 tests |
| Redaction regression | `npm test -- redaction-regression` | PASS — 1 file, 7 tests |
| Retrieve contract | `npm test -- retrieve-contract` | PASS — 1 file, 9 tests |
| Write contract | `npm test -- write-contract` | PASS — 1 file, 5 tests |
| Edit contract | `npm test -- edit-contract` | PASS — 1 file, 5 tests |
| Manage contract | `npm test -- manage-contract` | PASS — 1 file, 6 tests |
| Validation tool | `npm test -- validation-tool` | PASS — 1 file, 7 tests |
| Validation path safety | `npm test -- validation-path-safety` | PASS — 1 file, 4 tests |
| Plan preview | `npm test -- plan-preview` | PASS — 1 file, 3 tests |
| Plan request validation | `npm test -- plan-request-validation` | PASS — 1 file, 2 tests |
| Plan path safety | `npm test -- plan-path-safety` | PASS — 1 file, 2 tests |
| Plan conflicts | `npm test -- plan-conflicts` | PASS — 1 file, 3 tests |
| Plan output ordering | `npm test -- plan-output-ordering` | PASS — 1 file, 1 test |
| Plan no mutation | `npm test -- plan-no-mutation` | PASS — 1 file, 1 test |
| Package dry run | `npm pack --dry-run` | PASS — 53 files, 1.3 MB package size |
| Package dry run JSON | `npm pack --dry-run --json` | PASS — contents recorded below for 0.1.1 |

No focused test aliases were unavailable. Exact focused equivalents run for validation and plan were `validation-tool`, `validation-path-safety`, `plan-preview`, `plan-request-validation`, `plan-path-safety`, `plan-conflicts`, `plan-output-ordering`, and `plan-no-mutation`.

## Smoke-test safety requirements

Committed smoke tests use temporary or disposable vaults only. Real-vault smoke checks are opt-in/manual only. Release docs do not instruct users or maintainers to run destructive or committed tests against a real vault by default.

Smoke coverage preserves these guarantees:

- No overwrite.
- Dry-run-first mutation workflow.
- Confirmation-token safety for token-required commits.
- Redacted output.
- No shell/network expansion.
- No broad vault scan, broad folder dump, broad backlink scan, or broad relationship crawl.

Optional real-vault evaluation is manual/opt-in only and is not part of the default publish gate.

## Package contents inspection

Final dry-run command:

```bash
npm pack --dry-run --json
```

Result: `pi-obsidian-vault-0.1.1.tgz`, 53 files, 1.3 MB package size, 1.8 MB unpacked size.

### Last recorded package dry-run contents

```text
CHANGELOG.md
LICENSE
README.md
RELEASE.md
SECURITY.md
assets/pi-obsidian-vault-cover.png
package.json
skills/obsidian-research/SKILL.md
skills/obsidian-research/references/project-index-template.md
skills/obsidian-research/references/research-note-template.md
skills/obsidian-research/references/vault-conventions.md
src/agent-guidance.ts
src/candidate-collector.ts
src/commit-token-types.ts
src/commit-token.ts
src/config.ts
src/context-packer.ts
src/edit-engine.ts
src/edit-guidance.ts
src/edit-types.ts
src/errors.ts
src/exact-text-editor.ts
src/frontmatter-editor.ts
src/index.ts
src/manage-engine.ts
src/manage-guidance.ts
src/manage-types.ts
src/markdown-section-editor.ts
src/metadata-enricher.ts
src/note-inspection.ts
src/note-parser.ts
src/note-validation.ts
src/obsidian-cli.ts
src/path-safety.ts
src/plan-engine.ts
src/plan-types.ts
src/preview.ts
src/query-profile.ts
src/ranker.ts
src/relationship-engine.ts
src/relationship-types.ts
src/retrieval-engine.ts
src/retrieval-types.ts
src/section-selector.ts
src/target-lock.ts
src/validation-engine.ts
src/validation-types.ts
src/vault-editor.ts
src/vault-manager.ts
src/vault-writer.ts
src/write-engine.ts
src/write-guidance.ts
src/write-types.ts
```

Package contents include intended source, skill, README, cover image asset, license, changelog, security, release, and package metadata files. Package contents exclude `specs/`, `.specify/`, `tests/`, `node_modules/`, logs, secrets, local config, local vault data, and coverage artifacts.

## Release checklist

- [x] `package.json` name/version/description/license/repository/keywords/scripts are public-release-ready.
- [x] `package.json` has no release-blocking `private` flag.
- [x] `package.json` `pi.extensions` points to `./src/index.ts`.
- [x] `package.json` `pi.skills` matches the intended shipped skill.
- [x] `package.json` `files` whitelist includes only intended package files.
- [x] README install command is exactly `pi install npm:pi-obsidian-vault`.
- [x] README includes install, reload/restart, config, env vars, quick start, tool overview, examples, commit-token workflow, security model, limitations, troubleshooting, and release/version info.
- [x] `SECURITY.md` documents explicit paths, dry-run-first mutations, commit tokens, read-only tools, redaction, unsupported operations, no shell/network expansion except controlled CLI adapter, and reporting guidance.
- [x] `CHANGELOG.md` includes the initial `0.1.0` public release entry and the `0.1.1` package-page polish patch entry.
- [x] Focused no-shell-network, side-effect-refusal, redaction, contract, validation, plan, and status checks pass.
- [x] `npm run check` passes.
- [x] `npm pack --dry-run` succeeds.
- [x] Package contents include intended files and exclude specs, tests, `.specify`, `node_modules`, logs, secrets, local config, local vault data, and coverage.
- [x] Status command smoke check is covered by focused temporary-vault tests and `status-capabilities` with redacted output.
- [ ] Install smoke check from the published npm package remains a post-publish manual step.
- [x] Final implementation report includes exact commands/results, package files, npm publish readiness, exact publish command, exact Pi install command, and manual steps.

## Publish readiness summary

Status: Ready for maintainer-controlled npm publication after manual npm authentication and final human approval.

The package is publish-ready based on local checks. NPM publication itself remains manual because registry publication is irreversible and may require npm login/2FA.

## Manual release steps

1. Confirm working tree contains only intended release changes.
2. Confirm `npm run check` passes.
3. Confirm `npm pack --dry-run` contents are correct.
4. Confirm npm authentication:

   ```bash
   npm whoami
   ```

5. Publish:

   ```bash
   npm publish
   ```

6. After npm publication, smoke-test installation in a clean Pi session:

   ```bash
   pi install npm:pi-obsidian-vault
   ```

7. Reload or restart Pi and run `/obsidian-vault` with redacted output.
8. Optionally create a Git tag and GitHub release for `v0.1.1`.
