# Contributing to Mnemis

Thanks for your interest in Mnemis. This document explains how to set up the project and contribute.

## Development setup

You need:

- **Node** >= 22
- **Bun** >= 1.3 (used as package manager, runtime, and bundler)
- **Docker** (for Postgres locally)

```bash
git clone https://github.com/<org>/mnemis
cd mnemis
bun install
cp .env.example .env

# Start Postgres
bun run docker:up

# Run migrations
bun run db:migrate

# Create a local workspace and API key
bun run db:bootstrap -- --email you@example.com --workspace local

# Start the API and worker in separate terminals
bun run api:dev
bun run worker:dev
```

The API should be reachable at `http://localhost:8787/health`.

### Optional: GitHub App for private repos

To index private GitHub repositories, register a GitHub App (Settings → Developer settings → GitHub Apps), install it on the org/account you want to index, and set:

- `GITHUB_APP_ID` — numeric App ID
- `GITHUB_APP_PRIVATE_KEY` — PKCS#8 PEM downloaded from the App settings page
- `GITHUB_WEBHOOK_SECRET` — shared secret configured in the App's webhook section

Without these vars the worker still clones **public** repos; sources that set `config.githubInstallationId` will fail with `github_app_not_configured`.

### Running the MCP server

`apps/mcp` exposes Mnemis as an MCP server over stdio for clients like Cursor, Claude Code, or any other MCP-aware agent.

```bash
export MNEMIS_API_URL=http://localhost:8787
export MNEMIS_API_KEY=mn_test_...
bun --filter @mnemis/mcp dev
```

Tools registered today:

- Sources: `source_search`, `source_index`, `source_list`, `source_get`, `source_status`, `source_reindex`
- Memories: `memory_save`, `memory_search`, `memory_list`, `memory_retrieve`, `memory_update`, `memory_delete`
- GitHub App: `github_installation_list`, `github_installation_register`

Run the MCP server after setting `MNEMIS_API_URL` and `MNEMIS_API_KEY`.

To wire it into Claude Code, add to `~/.config/claude-code/mcp.json` (or the equivalent for your client):

```json
{
  "mcpServers": {
    "mnemis": {
      "command": "/path/to/mnemis/apps/mcp/bin/mnemis-mcp.js",
      "env": {
        "MNEMIS_API_URL": "http://localhost:8787",
        "MNEMIS_API_KEY": "mn_test_..."
      }
    }
  }
}
```

## Project structure

```
apps/
  api/        — REST API (Hono on Node 22)
  cli/        — Mnemis CLI
  mcp/        — Standalone MCP server over stdio
  worker/     — Index job worker
packages/
  db/         — Drizzle schema + migrations
  sdk/        — TypeScript SDK
  indexer/    — Repo and docs indexers
  eval/       — Retrieval-quality evaluation helpers
  embeddings/ — Embedding provider abstraction
docker/       — Docker compose + Dockerfiles
docs/         — Architecture, API reference, research
```

## Commit convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation change
- `refactor:` code change that does not alter behavior
- `test:` tests
- `chore:` tooling, CI, deps

## Before opening a PR

```bash
bun run typecheck
bun run lint
bun run test:local
```

CI runs all of these on every PR — make sure they pass locally first.

## Code style

- Biome handles formatting and linting; do not hand-format.
- Prefer small focused PRs.
- New features need tests. Bug fixes ideally come with a regression test.
- Open questions or design tradeoffs: surface them in the PR description rather than hiding them in comments.
