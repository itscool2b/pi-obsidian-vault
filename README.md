# Pi Obsidian Retrieval Harness

A small, read-only Pi extension for retrieving Obsidian vault context through the official `obsidian` CLI.

## Public tool surface

The extension registers one Pi-facing tool:

- `obsidian_retrieve` — candidate-first search, selected-note context, graph summaries, and project/topic retrieval.

It also registers the existing status command:

- `/obsidian-vault` — reports CLI/vault configuration health.

Legacy read/search/list/write/open-style tools are intentionally not registered. `obsidian_retrieve` warns on write/open intent and never performs side effects.

## Configuration

```env
OBSIDIAN_CLI_PATH=obsidian
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

When a vault name/id is configured, the adapter invokes the CLI as `obsidian vault=<target> <command> ...`. Otherwise it runs the CLI with `cwd` set to `OBSIDIAN_VAULT_PATH`.

## Usage examples

Candidate discovery:

```json
{ "query": "integrated gradients", "mode": "search", "budget": "standard" }
```

Selected-note context:

```json
{
  "mode": "context",
  "query": "implementation details",
  "selected": [{ "path": "Research/Integrated Gradients/index.md" }]
}
```

Graph/project retrieval:

```json
{ "query": "Pi retrieval architecture", "mode": "project", "scope": { "folder": "Projects" } }
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
