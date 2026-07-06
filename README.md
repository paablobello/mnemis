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
3. **Retrieval** — keyword or hybrid vector + Postgres full-text retrieval with RRF-style fusion, optional Voyage or local BGE reranking, and cited raw, markdown or synthesized responses. Permalinks pin to the indexed commit SHA. Our [self-corpus baseline](./reports/2026-05-20-baseline.md) shows Voyage rerank lifting nDCG@10 from 0.20 → 0.51 (+158%) and Recall@5 from 0.19 → 0.62 (triples) on top of plain BM25.
4. **MCP first** — works with Cursor, Claude Code, Codex, Windsurf, Zed out of the box.

## Quick start

```bash
git clone https://github.com/paablobello/mnemis
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

## Live research and PDF extraction

For the strongest research workflow, configure at least one web search provider
(`TAVILY_API_KEY` or `EXA_API_KEY`), `OPENALEX_EMAIL` for academic discovery,
`GITHUB_TOKEN` or `MNEMIS_GITHUB_TOKEN` for higher GitHub Search limits,
`FIRECRAWL_API_KEY` for high-quality web/docs crawling, and `VOYAGE_API_KEY` for
embeddings. `SEMANTIC_SCHOLAR_API_KEY` is optional: without it, Semantic Scholar
may return 429s and Mnemis will continue through OpenAlex/arXiv/Crossref where
available. Research runs can enable or disable general web, GitHub repositories,
academic papers, and PDFs independently (`includeWeb`, `includeGithub`,
`includePapers`, `includePdfs`), which is useful for agent workflows such as
repo-only or papers-only investigations.

Text-rich PDFs work through the native extractor in `pdfExtractor=auto`. For
sparse/scanned PDFs or highest-quality paper metadata, run the Docling/GROBID
sidecar:

```bash
docker compose -f docker/docker-compose.yml --profile pdf up -d pdf-extractor
```

Then set:

```env
MNEMIS_PDF_EXTRACTOR_URL=http://localhost:8790/extract
```

Leave `MNEMIS_PDF_EXTRACTOR_URL` empty when the sidecar is not running. In the
production Compose stack with `--profile pdf`, use:

```env
MNEMIS_PDF_EXTRACTOR_URL=http://pdf-extractor:8790/extract
```

Repeatable live QA checks are available once Postgres, API, worker, and any
needed provider keys are running:

```bash
bun run qa:research:smoke
bun run qa:research:deep
bun run qa:mcp-live
bun run qa:mcp-agent-research
```

`qa:mcp-agent-research` is the closest check to the intended agent workflow: it
connects through MCP, launches web, GitHub, and academic research without seed
URLs, waits for indexing where applicable, searches the indexed corpus, then
saves and retrieves a memory from the same MCP client.

For agents, the highest-level MCP entrypoint is `mnemis_research_and_remember`:
it searches prior memories, discovers and indexes fresh web/GitHub/paper/PDF
sources, searches the indexed evidence, and saves a reusable memory in one tool
call.

For agent clients, prefer `bun run cli init` or the published `@mnemis/mcp`
package entrypoint. Local dev wrappers such as `bun --filter @mnemis/mcp start`
are for development and are not the recommended MCP client command.

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

## Hosted SaaS dashboard

The hosted beta surface lives in `apps/web` and is intentionally operational:
it is for onboarding workspaces, creating API keys, launching indexing/research,
checking usage, and opening Stripe billing. It uses Clerk for human login and
keeps the existing API-key flow for MCP/CLI/SDK agents.
When a Clerk organization is active, its `orgId` is mapped to the Mnemis
workspace `external_id`; otherwise the dashboard creates a personal beta
workspace for the signed-in user.

```bash
cd apps/web
bun run dev
```

Required dashboard env:

```env
DATABASE_URL=postgres://...
INTERNAL_AUTH_SECRET=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_MNEMIS_API_URL=http://localhost:8787
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
# Per-tier subscription prices used by /pricing (USD, monthly recurring)
STRIPE_PRICE_BUILDER=price_...
STRIPE_PRICE_TEAM=price_...
STRIPE_PRICE_BUSINESS=price_...
```

Billing uses Stripe Billing with Checkout Sessions for subscription start and
Customer Portal for self-service changes. API quota enforcement is off in
self-host mode and turns on by default when `MNEMIS_MODE=cloud`; it can be
forced with `MNEMIS_ENFORCE_CREDITS=true`. The default beta allowance is
`MNEMIS_FREE_MONTHLY_CREDITS=10000` unless overridden.

### Pricing tiers

Four tiers ship out of the box, plus an Enterprise contact link rendered on
`/pricing`. Limits map 1:1 to columns on the `plans` table.

| Tier       | Price/mo  | Credits/mo  | Sources | Research/mo |
| ---------- | --------- | ----------- | ------- | ----------- |
| Free       | $0        | 1,000       | 3       | 5           |
| Builder    | $15       | 15,000      | 50      | 30          |
| Team       | $50       | 75,000      | 500     | 200         |
| Business   | $99       | Unlimited   | Unlimited | Unlimited |
| Enterprise | custom    | Unlimited   | Unlimited | Unlimited |

Seed (or re-seed) the `plans` table after creating the corresponding products
in Stripe and pasting their `price_*` IDs into the env block above:

```bash
bun run --filter=@mnemis/db seed:plans
```

For local subscription flows you also need the Stripe CLI listening on the
webhook endpoint so checkout completions reach the dashboard:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# copy the printed whsec_... into STRIPE_WEBHOOK_SECRET and restart apps/web
```

Workspaces with no active subscription resolve to the Free tier through
`getPlanForWorkspace`. Subscriptions in status `active` or `trialing` grant
plan benefits; everything else (canceled, past_due, etc.) falls back to Free.

## Architecture

Single Postgres for everything (pgvector + tsvector + relational data + jobs table). TypeScript everywhere (Bun + Node 22). MCP server, REST API, CLI, and integrations share the same TypeScript SDK. Docs can use the native crawler or Firecrawl when `FIRECRAWL_API_KEY` is configured.

See `docs/research/tech-decisions.md` for full architectural rationale.

## License

[MIT](./LICENSE).
