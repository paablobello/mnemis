# Mnemis

> Open-source memory and context platform for AI agents.

Mnemis gives AI coding agents (Cursor, Claude Code, Codex, etc.) **persistent memory** and **fresh, cited retrieval over your repos and docs** — through a single MCP server, REST API, and CLI.

**Status**: alpha (v0.1.0). The API, worker, MCP server, TypeScript SDK and CLI are
all present and exercised by the test suite. Local Bun development, production
docker-compose and `mnemis init` for Cursor/Claude Code/Windsurf/Zed are
shipped. Hosted cloud UX is the next milestone.

## What it is

Mnemis combines:

1. **Memory** — agents save plans, decisions, and conversation state with typed TTLs (working / session / fact / procedural). Other agents pick up where they left off.
2. **Indexing** — GitHub repos and docs sites through the worker, with include/exclude filters, docs crawling, and optional contextual prefixes.
3. **Retrieval** — keyword or hybrid vector + Postgres full-text retrieval with RRF-style fusion, optional Voyage or local BGE reranking, and cited raw, markdown or synthesized responses. Permalinks pin to the indexed commit SHA. The local cross-encoder more than doubles nDCG/MRR over plain BM25 on our [self-corpus baseline](./reports/2026-05-20-baseline.md).
4. **MCP first** — works with Cursor, Claude Code, Codex, Windsurf, Zed out of the box.

## Quick start

```bash
git clone https://github.com/<org>/mnemis
cd mnemis
bun install
cp .env.example .env
bun run docker:up
bun run db:migrate
bun run db:bootstrap -- --email you@example.com --workspace local

# In separate terminals:
bun run api:dev
bun run worker:dev
```

Then create or bootstrap an API key, configure the CLI, and register sources:

```bash
bun run cli auth login --url http://localhost:8787 --key mn_...
bun run cli repos add owner/repo --branch main --strategy webhook
bun run cli docs add https://docs.example.com --max-pages 100
bun run cli docs add https://docs.example.com --strategy cron --cron "0 3 * * *"
bun run cli status
```

For full CLI and SDK usage, see [`docs/cli-sdk.md`](./docs/cli-sdk.md).

## Production self-host (Docker)

A ready-to-run stack with Postgres + API + worker lives in
`docker/docker-compose.prod.yml`:

```bash
cp .env.prod.example .env.prod
# edit POSTGRES_PASSWORD, INTERNAL_AUTH_SECRET and any provider keys you need
docker compose -f docker/docker-compose.prod.yml --env-file .env.prod up -d

# one-off before first boot: apply the schema inside the Compose network
docker compose -f docker/docker-compose.prod.yml --env-file .env.prod --profile tools run --rm migrate
```

The API listens on `${API_PORT}` (default 8787); both api and worker share
the same Postgres volume and start with healthchecks. Optional integrations
(Voyage, Anthropic, Firecrawl, GitHub App, local reranker) are pure env
vars — set them in `.env.prod` and `docker compose restart`.

## Architecture

Single Postgres for everything (pgvector + tsvector + relational data + jobs table). TypeScript everywhere (Bun + Node 22). MCP server, REST API, CLI, and integrations share the same TypeScript SDK. Docs can use the native crawler or Firecrawl when `FIRECRAWL_API_KEY` is configured.

See `docs/research/tech-decisions.md` for full architectural rationale.

## License

[MIT](./LICENSE).
