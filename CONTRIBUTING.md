# Contributing to Mnemis

Thanks for your interest in Mnemis. This document explains how to set up the project and contribute.

## Development setup

You need:

- **Node** >= 22
- **Bun** >= 1.3 (used as package manager, runtime, and bundler)
- **Docker** (for Postgres + Redis locally)

```bash
git clone https://github.com/<org>/mnemis
cd mnemis
bun install
cp .env.example .env

# Start Postgres + Redis
bun run docker:up

# Run migrations
bun run db:migrate

# Start the API in dev mode
bun run api:dev
```

The API should be reachable at `http://localhost:8787/health`.

## Project structure

```
apps/
  api/        — REST API + MCP transport (Hono on Node 22)
  cli/        — Mnemis CLI (Bun)
  mcp/        — Standalone MCP server (Bun)
packages/
  db/         — Drizzle schema + migrations
  core/       — Shared business logic
  sdk/        — TypeScript SDK
  indexer/    — Repo and docs indexers
  chunker/    — tree-sitter AST chunking + contextual prefix
  search/     — Hybrid search + RRF + reranker
services/
  reranker/   — Optional Python ONNX reranker service
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
bun run test
```

CI runs all of these on every PR — make sure they pass locally first.

## Code style

- Biome handles formatting and linting; do not hand-format.
- Prefer small focused PRs.
- New features need tests. Bug fixes ideally come with a regression test.
- Open questions or design tradeoffs: surface them in the PR description rather than hiding them in comments.
