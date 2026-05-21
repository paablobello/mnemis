# Deep Live Audit - 2026-05-21

Base commit audited: `b6e169a Add SaaS dashboard foundation`

## Verdict

Core platform: **PASS for technical beta**. API, worker, MCP, DB, Docker, source indexing, web discovery, docs/blog crawling, PDF indexing, embeddings, contextual prefixes, and live research flows all passed practical tests against local Postgres plus configured external providers.

SaaS/public launch: **not ready to sell until Clerk + Stripe are configured and live-tested**. The previous generic HTTP 500 behavior is fixed: without Clerk/Stripe, web now returns explicit setup responses. Real login, checkout, billing portal, and signed Stripe webhooks still require test-mode credentials.

## Post-Fix Update

Implemented after this audit:

- Added web configuration helpers for Clerk and Stripe.
- Prevented `apps/web` from rendering Clerk provider/components when Clerk env is missing.
- Changed missing-Clerk runtime behavior:
  - `/`: HTTP 200 with a setup notice.
  - `/dashboard`: HTTP 307 to `/?setup=missing-clerk`.
  - `/api/stripe/webhook`: no longer blocked by Clerk middleware.
- Changed missing-Stripe webhook behavior to HTTP 503 JSON: `{"error":"stripe_webhook_not_configured"}`.
- Added `@mnemis/web` tests for Clerk/Stripe configuration checks.
- Moved enum-like DB check constraints into Drizzle schema and made `0002_hardening_constraints.sql` a no-drop backfill.

Post-fix verification:

- `bun run lint`: PASS.
- `bun run typecheck`: PASS, 12/12 tasks.
- `bun run build`: PASS, 6/6 build tasks.
- Fresh DB `db:push:ci`: PASS.
- Repeat DB `db:push:ci`: PASS; no constraint drop/re-add statements. Remaining repeated statements are array default ALTERs from Drizzle.
- Web runtime without Clerk:
  - `/`: HTTP 200.
  - `/dashboard`: HTTP 307 to setup notice.
  - `/api/stripe/webhook`: HTTP 503 clear JSON.
- `DATABASE_URL=... INTERNAL_AUTH_SECRET=test-secret MNEMIS_ALLOW_LOCAL_SOURCES=true bun run test --force`: PASS, 12/12 tasks.

## SaaS Setup Update

Follow-up setup after the audit:

- Clerk local env is now populated and the production web build passes with Clerk enabled.
- Created a new live Stripe product specifically for Mnemis:
  - Product: `prod_UYl31NlXBPtdpD` (`Mnemis Pro`)
  - Default monthly Price: `price_1TZdY3QNDB93LP1EvTmxanRI` (`49 USD/month`)
- Updated local `.env` with `NEXT_PUBLIC_MNEMIS_API_URL` and `STRIPE_PRICE_ID_PRO`.
- Kept the old `Pact Pro Weekly` Stripe product/prices unused.
- Moved Clerk UI controls out of the root layout into client-only controls so `next build` does not break when Clerk env is present.
- Added a root `global-error.tsx` fallback.
- Updated Biome ignores so ignored local Claude settings do not break repo lint.

Post-setup verification:

- `bun run lint`: PASS.
- `bun run typecheck`: PASS, 12/12 tasks.
- `bun --env-file=.env --filter @mnemis/web test`: PASS, 4/4 web tests.
- `bun run build`: PASS, 6/6 build tasks.
- Runtime web with Clerk configured and Stripe secrets still missing:
  - `/`: HTTP 200.
  - `/dashboard`: HTTP 307 to Clerk sign-in.
  - `/api/stripe/webhook`: HTTP 503 clear JSON.

Remaining SaaS blocker: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are still empty locally. Stripe MCP can create products/prices, but it does not expose account API secret keys. Checkout, billing portal, and signed webhook persistence still require adding a Stripe secret key and webhook signing secret.

## Environment

- Bun: `1.3.1`
- Node: `v22.13.1`
- Docker services: Postgres, Redis, PDF extractor, and GROBID were healthy.
- Configured providers: Anthropic, Voyage, Firecrawl, Tavily, Exa, OpenAlex, PDF sidecar.
- Missing or intentionally empty providers: Semantic Scholar API key, Brave, Clerk, Stripe.
- Audit DB: `mnemis_deep_audit_20260521`

## Evidence

| Area | Result | Notes |
| --- | --- | --- |
| Git hygiene | PASS | Started from a clean tree at `b6e169a`. |
| Dependency audit | PASS | `bun audit`: no vulnerabilities found. |
| Secret scan | PASS | No real key patterns found in tracked files. `.env` is not tracked. |
| Formatting/lint | PASS | `bun run lint`: 146 files checked, no fixes. |
| Typecheck | PASS | `bun run typecheck`: 12/12 Turbo tasks successful. |
| Build | PASS | `bun run build`: API, worker, CLI, MCP, SDK, and Next web build successful. |
| Fresh DB schema | PASS | `db:push:ci` applied on isolated Postgres DB. Final state had 15 public tables, required extensions, and sampled hardening constraints present. |
| Full test suite | PASS | `bun run test --force`: 12/12 tasks successful, no cache. API 74 tests, worker 32, MCP 18, CLI 18, SDK 14, SaaS 4. Web package currently has 0 tests. |
| API/worker live | PASS | API `/health` returned `status=ok` and DB ok; worker processed live jobs. |
| MCP live | PASS | Built MCP server exposed 17 tools; saved/searched memory, indexed a web page, searched source content, queued/completed research. |
| Research smoke | PASS | 3/3 seed sources indexed: React docs, LogRocket blog, arXiv PDF. 88 chunks embedded with `voyage-4-large`; PDF search returned page citations. |
| Deep research QA | PASS | Tavily/Exa discovery, academic discovery, Firecrawl page/blog/docs crawl, native PDF, sidecar PDF, Anthropic contextual prefix, seed URL research, web discovery indexing, and academic indexing all passed. Details updated in `reports/2026-05-21-deep-research-qa.md`. |
| PDF quality path | PASS with latency | Native arXiv PDF path: 538ms, 15 pages, 31 chunks. Forced sidecar Docling/GROBID path: 79.4s, 15 pages, 37 chunks, better title/content metadata. |
| Docker builds | PASS | `docker/Dockerfile.api`, `docker/Dockerfile.worker`, and `docker/Dockerfile.migrate` built successfully. |
| Compose production config | PASS with env | Fails closed without required `POSTGRES_PASSWORD`; validates with dummy required env, including `pdf` and `tools` profiles. |
| SaaS web runtime | PASS degraded mode | `next start` boots without Clerk keys; `/` returns 200 setup notice, `/dashboard` redirects to setup, Stripe webhook returns 503 JSON when Stripe is missing. |

## Findings

### P1 - SaaS web hard-fails without Clerk configuration

Status: **closed for degraded runtime behavior**. The current `.env` has `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` empty. Before the fix, production Next started but every tested route returned HTTP 500:

- `/`: HTTP 500
- `/dashboard`: HTTP 500
- `/api/stripe/webhook`: HTTP 500

Runtime log:

```text
@clerk/nextjs: Missing publishableKey
```

Relevant code:

- `apps/web/app/page.tsx` imports Clerk UI and calls `auth()` on the public landing page.
- `apps/web/proxy.ts` installs `clerkMiddleware` globally for matched routes.
- `.env.example` documents Clerk/Stripe as required for `apps/web`, but the current local `.env` still leaves them empty.

Impact now: the app no longer returns generic 500s without Clerk, but the real SaaS dashboard still cannot be used until Clerk test/production keys are configured.

### P1 - SaaS commercial flow is not live-verified

The Stripe integration follows the correct SaaS pattern: Checkout Session in `subscription` mode, Prices, Customer Portal, signed webhook validation, and subscription/customer persistence. However, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID_PRO` are empty in the current `.env`, so checkout, portal, and signed webhook handling were not exercised against Stripe test mode.

Impact: the core product can be beta-tested by agents, but the paid SaaS cannot be considered launch-ready until Clerk + Stripe test-mode credentials are configured and the full signup -> workspace -> checkout -> webhook -> billing state flow passes.

### P2 - `db:push:ci` is successful but not a clean no-op on repeat

Status: **constraint issue closed; array-default noise remains**. Before the fix, Drizzle generated statements to drop enum-like hardening constraints before `post-migrate` added them back. The constraints now live in Drizzle schema and the post migration only backfills missing constraints without dropping them.

Relevant code:

- `packages/db/migrations/post/0002_hardening_constraints.sql`
- `packages/db/src/schema.ts`

Impact now: repeat `db:push:ci` no longer drops/re-adds hardening constraints. Drizzle still repeats harmless array default ALTER statements for several array columns.

### P2 - Web package has no tests

Status: **partially closed**. `@mnemis/web:test` now has configuration coverage for Clerk/Stripe and Stripe client fail-closed behavior. SaaS server actions, Clerk workspace provisioning, Stripe checkout action, billing portal action, and signed webhook persistence still need deeper automated coverage before this becomes a sellable product.

Impact: backend/research reliability is well covered; SaaS UI/commercial workflows are still under-tested.

### P3 - Shared `.env` sets `NODE_ENV=development`

`next start` emitted a non-standard `NODE_ENV` warning because the local `.env` loaded `NODE_ENV=development` while running the production server. Docker production forces `NODE_ENV=production`, so deploy containers are fine.

Impact: low for production Docker, but confusing for local production testing. Avoid loading the shared dev `.env` into `next start`, or split development/runtime env files.

### P3 - External provider degradation is working but should be visible in product UI

Observed non-fatal provider issues:

- Brave is not configured.
- Semantic Scholar can still rate-limit with HTTP 429 when no API key is present.
- LinkedIn was discovered but blocked by robots during crawling.

The worker continued through Tavily, Exa, OpenAlex/Crossref, Firecrawl, and seed URLs. This is good behavior, but the SaaS UI should expose provider warnings and failed source reasons clearly.

### P3 - High-quality PDF extraction is correct but slow

The forced sidecar path produced better structured output than native extraction, but took about 79 seconds for `Attention Is All You Need`. This is acceptable as an async worker job, not as a synchronous user interaction.

Impact: keep PDF extraction async, show progress/status, and use native-first auto mode for fast text PDFs.

## Publicability Assessment

- **Usable today for agent/research beta:** yes. MCP, API, worker, indexing, research, embeddings, cited search, and PDF handling are working.
- **Publishable as open-source/self-host technical beta:** yes, with clear setup docs and expected provider-key caveats.
- **Ready to sell as SaaS:** not yet. Clerk and Stripe must be configured and live-tested, web runtime 500s must be eliminated, and web/commercial tests should be added.
- **Architecture direction:** solid. Keep this repo together for now; there is no evidence that splitting services into separate repos would improve quality at this stage.

## Recommended Next Fixes

1. Configure Clerk and Stripe test-mode env, then run a live SaaS smoke covering signup/login, dashboard render, API key creation, source queueing, checkout, signed webhook, subscription state, and billing portal.
2. Add web tests for dashboard server actions, Stripe webhook signature handling, missing-env behavior, and Clerk workspace provisioning.
3. Add a deploy/runtime env validator for `apps/web` so missing Clerk/Stripe produces a clear startup/deploy error instead of generic route 500s.
4. Clean up DB migration discipline so repeat production schema application does not drop/re-add hardening constraints.
5. Surface provider warnings in the SaaS dashboard for research runs and source indexing.

## Cleanup Notes

No secrets were printed. Docker API/worker/migrate images were built with audit tags. Temporary API/worker/web dev processes were stopped after the audit. The isolated audit DB was dropped after preserving this report.
