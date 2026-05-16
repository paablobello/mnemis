# Mnemis

> Open-source memory and context platform for AI agents.

Mnemis gives AI coding agents (Cursor, Claude Code, Codex, etc.) **persistent memory** and **fresh, cited retrieval over your repos and docs** — through a single MCP server, REST API, and CLI.

**Status**: pre-alpha, in active development. Not yet usable. See `docs/research/tech-decisions.md` for the technical roadmap.

## What it is

Mnemis combines:

1. **Memory** — agents save plans, decisions, and conversation state with typed TTLs (working / session / fact / procedural). Other agents pick up where they left off.
2. **Indexing** — repos (webhook-driven reindex) and docs sites (Firecrawl crawler). AST-aware code chunking with tree-sitter + parent-child strategy.
3. **Retrieval** — hybrid vector + BM25 with RRF fusion, reranked by mxbai-rerank-large-v2. Anthropic Contextual Retrieval prefix on every chunk.
4. **MCP first** — works with Cursor, Claude Code, Codex, Windsurf, Zed out of the box.

## Quick start (coming soon)

```bash
# Self-host with Docker
git clone https://github.com/<org>/mnemis
cd mnemis
docker compose -f docker/docker-compose.yml up -d

# Or use Mnemis Cloud
npx mnemis@latest  # wizard configures your agent in <1 min
```

## Architecture

Single Postgres for everything (pgvector + tsvector + relational + jobs via pg-boss). TypeScript everywhere (Bun + Node 22). MCP server, REST API, and CLI all backed by the same core packages.

See `docs/research/tech-decisions.md` for full architectural rationale.

## License

[MIT](./LICENSE).
