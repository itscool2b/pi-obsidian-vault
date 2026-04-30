# Pi Obsidian Retrieval Harness

A small, read-only Pi extension for retrieving Obsidian vault context through the official `obsidian` CLI.

## Public tool surface

The extension registers one Pi-facing tool:

- `obsidian_retrieve` — candidate-first search, selected-note context, graph summaries, and project/topic retrieval.

It also registers the existing status command:

- `/obsidian-vault` — reports CLI/vault configuration health.

Legacy read/search/list/write/open-style tools are intentionally not registered. `obsidian_retrieve` warns on write/open intent and never performs side effects.

## First-time setup

1. Make the vault location persistent for Pi. The simplest option is:

```bash
mkdir -p ~/.pi/agent
cat > ~/.pi/agent/obsidian-vault.json <<'JSON'
{
  "vaultPath": "/absolute/path/to/vault",
  "cliPath": "obsidian-cli"
}
JSON
```

Replace `/absolute/path/to/vault` with your real vault folder, then run `/obsidian-vault` in Pi. The status command is side-effect-free: it reports whether the CLI can reach a running Obsidian instance, but it does not open Obsidian. If `obsidian` opens the desktop app on your system, use `obsidian-cli` for `cliPath`/`OBSIDIAN_CLI_PATH`.

### Pi-assisted setup prompt

You can also ask Pi to create the config for you. Paste this into Pi after replacing the vault path:

```text
Set up the Obsidian retrieval extension.

My Obsidian vault path is:

/replace/with/path/to/vault

Please:
1. Create or update ~/.pi/agent/obsidian-vault.json.
2. Set "vaultPath" to the path above.
3. Prefer "cliPath": "obsidian-cli" if obsidian-cli exists on PATH; otherwise ask me before using any other CLI path.
4. Verify the vault path exists and is a directory.
5. Do not scan, read, modify, open, or write any notes in the vault.
6. After setup, tell me whether I need to restart Pi.
7. Ask me to run /obsidian-vault and confirm it shows Source: config.
```

You can also configure through environment variables:

```env
OBSIDIAN_CLI_PATH=obsidian-cli
OBSIDIAN_VAULT_PATH=/absolute/path/to/vault
# or
OBSIDIAN_VAULT_NAME="My Vault"
# or
OBSIDIAN_VAULT_ID="vault-id"

OBSIDIAN_CLI_TIMEOUT_MS=10000
OBSIDIAN_RETRIEVE_TINY_CHARS=3500
OBSIDIAN_RETRIEVE_STANDARD_CHARS=8000
OBSIDIAN_RETRIEVE_EXPANDED_CHARS=12000
```

When a vault name/id is configured, the adapter invokes the configured CLI as `<cliPath> vault=<target> <command> ...`. Otherwise it runs the CLI with `cwd` set to `OBSIDIAN_VAULT_PATH` or the path saved in `~/.pi/agent/obsidian-vault.json`.

## Usage examples

Supported top-level request fields are exactly: `query`, `mode`, `selected`, `scope`, `budget`, `maxCandidates`, and `explain`.

Valid `mode` values: `auto`, `search`, `context`, `graph`, `project`.
Valid `budget` values: `tiny`, `standard`, `expanded`.

Candidate discovery:

```json
{ "query": "integrated gradients", "mode": "search", "budget": "standard" }
```

Graph retrieval:

```json
{ "query": "Integrated Gradients connections", "mode": "graph", "budget": "expanded" }
```

Selected-note context using the exact `selectedRef` recommended by `agentGuidance.contextRecommendation`:

```json
{
  "mode": "context",
  "query": "implementation details",
  "selected": [{ "path": "Research/Integrated Gradients/index.md", "title": "Integrated Gradients" }],
  "budget": "standard"
}
```

Agent-facing guidance is returned on every successful response:

```json
{
  "agentGuidance": {
    "resultState": "request_context",
    "bestMatch": { "path": "Research/Integrated Gradients/index.md", "title": "Integrated Gradients" },
    "confidence": { "level": "high", "ambiguous": false },
    "contextRecommendation": {
      "recommended": true,
      "selected": [{ "path": "Research/Integrated Gradients/index.md", "title": "Integrated Gradients" }],
      "mode": "context"
    }
  }
}
```

Project retrieval:

```json
{ "query": "Pi retrieval architecture", "mode": "project", "scope": { "folder": "Projects" }, "budget": "standard" }
```

## Safety model

- Obsidian CLI is the discovery and metadata backend.
- No filesystem scanning is used for retrieval discovery.
- Note content is loaded only for selected candidates in `context` mode.
- Responses are capped by budget and report omissions/truncation.
- Broad vault/folder/multi-note dump requests return candidates and bounded summaries, not full note bodies.
- CLI invocation uses argv arrays with `shell: false`.

## Development

```bash
npm run typecheck
npm test
npm run check
```

Real-vault evaluation is opt-in:

```bash
OBSIDIAN_EVAL_VAULT=true OBSIDIAN_EVAL_QUERY="project" npm test -- real-vault-evaluation
```
