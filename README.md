# Mnemis

> Open-source memory and context platform for AI agents.

Mnemis gives AI coding agents (Cursor, Claude Code, Codex, etc.) **persistent memory** and **fresh, cited retrieval over your repos and docs** — through a single MCP server, REST API, and CLI.

**Status**: pre-alpha, usable for local development and integration testing. The API, worker, MCP server, TypeScript SDK, and CLI are present; hosted cloud UX and several retrieval-quality roadmap items are still in progress.

## What it is

Mnemis combines:

1. **Memory** — agents save plans, decisions, and conversation state with typed TTLs (working / session / fact / procedural). Other agents pick up where they left off.
2. **Indexing** — GitHub repos and docs sites through the worker, with include/exclude filters, docs crawling, and optional contextual prefixes.
3. **Retrieval** — keyword or hybrid vector + Postgres full-text retrieval with RRF-style fusion, optional Voyage reranking, and cited raw, markdown, or synthesized responses.
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

## Architecture

Single Postgres for everything (pgvector + tsvector + relational data + jobs table). TypeScript everywhere (Bun + Node 22). MCP server, REST API, CLI, and integrations share the same TypeScript SDK. Docs can use the native crawler or Firecrawl when `FIRECRAWL_API_KEY` is configured.

See `docs/research/tech-decisions.md` for full architectural rationale.

## License

[MIT](./LICENSE).
