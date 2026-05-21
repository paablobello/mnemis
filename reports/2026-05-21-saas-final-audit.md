# SaaS Final Audit - 2026-05-21

## Scope

Deep audit of the hosted SaaS surface after pricing, Clerk, Stripe Billing, quotas, dashboard and MCP-facing functionality were added.

Validated areas:

- Production build for `apps/web`.
- Public routes: `/`, `/pricing`.
- Protected route behavior: `/dashboard` anonymous redirect to Clerk.
- Stripe webhook behavior without a signature.
- Stripe subscription persistence logic at DB level.
- Dashboard source/research quota and credit accounting.
- API research quota enforcement.
- Worker indexing paths for docs, web pages and PDFs through the existing test suite.
- MCP tool contract tests.

Secrets were not printed. Stripe MCP/live resource mutation was not used during this audit.

## Findings Fixed

### P0 - `/pricing` crashed in production

The public pricing page rendered Clerk client components (`SignInButton`/`Show`) without a `ClerkProvider`.

Fix:

- Added a reusable `ClerkClientProvider`.
- Wrapped `/pricing` with it only when Clerk is configured.

Evidence:

- Before fix: `/pricing` returned `500`.
- After fix: `/pricing` returns `200` and renders Free, Builder, Team, Business and Enterprise.

### P1 - Stripe billing config depended on a legacy price variable

The new tiered Checkout flow resolved prices from the `plans` table, but `isStripeBillingConfigured()` still required `STRIPE_PRICE_ID_PRO`.

Impact:

- A clean tiered setup with `STRIPE_PRICE_BUILDER`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_BUSINESS` and seeded DB plans could still fail checkout config checks.

Fix:

- Billing config now requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- Removed the unused legacy dashboard checkout action.
- Updated README env docs to remove `STRIPE_PRICE_ID_PRO`.

### P1 - Stripe webhook upsert could fail on resubscribe/change

The webhook upsert targeted `stripe_subscription_id`, while the schema also enforces one subscription row per workspace.

Impact:

- If a workspace already had a subscription row and Stripe sent a new `sub_*`, insertion could conflict on `subscriptions_workspace_idx`.

Fix:

- Extracted webhook persistence into `apps/web/lib/stripe-webhook.ts`.
- Upserts subscriptions by `workspace_id`.
- Keeps the latest `stripe_subscription_id`, price, status, billing period and resolved plan.
- Added DB-backed tests for subscription replacement and checkout customer idempotency.

### P1 - Dashboard did not charge credits for queued work

API routes enforced/recorded usage, but dashboard server actions queued source indexing and research runs without credit accounting.

Impact:

- Dashboard users could create costly work while usage bars stayed inaccurate.

Fix:

- Added shared `researchRunCreditCost`.
- Added `assertWorkspaceCreditsAvailable`.
- Added `recordWorkspaceUsage`.
- Dashboard source indexing now charges `1` credit.
- Dashboard research runs now charge `quick=20`, `standard=60`, `deep=150`.
- API research route now uses the same shared cost function.
- Dashboard source/research creation now runs source/job/usage writes in a DB transaction with a per-workspace advisory lock.
- API source creation, API source reindex and API research creation now run quota checks, writes and usage recording inside the same per-workspace locked transaction.
- Added a concurrency test proving two simultaneous dashboard research runs cannot both pass when only one has credits available.

### P2 - Unlimited plan UI showed a huge numeric credit balance

Business/unlimited plans expose `Number.MAX_SAFE_INTEGER` internally for math. The dashboard metric rendered that number directly.

Fix:

- Dashboard now renders `Unlimited` for unlimited credits.

## Verification

Commands executed successfully:

```bash
bun run lint
bun run typecheck
DATABASE_URL=postgres://mnemis:mnemis_dev@localhost:5433/mnemis_saas_audit_20260521 INTERNAL_AUTH_SECRET=test-secret MNEMIS_ALLOW_LOCAL_SOURCES=true bun --filter @mnemis/web test
DATABASE_URL=postgres://mnemis:mnemis_dev@localhost:5433/mnemis_saas_audit_20260521 INTERNAL_AUTH_SECRET=test-secret MNEMIS_ALLOW_LOCAL_SOURCES=true bun --filter @mnemis/saas test
DATABASE_URL=postgres://mnemis:mnemis_dev@localhost:5433/mnemis_saas_audit_20260521 INTERNAL_AUTH_SECRET=test-secret MNEMIS_ALLOW_LOCAL_SOURCES=true bun run test --force
bun run build
```

Final full suite result:

- 12 successful tasks.
- API: 76 tests passed.
- Worker: 32 tests passed.
- MCP: 18 tests passed.
- Web: 6 tests passed.
- SaaS: 10 tests passed.
- No test failures.

Production HTTP checks on `http://127.0.0.1:3210`:

- `/` -> `200`.
- `/pricing` -> `200`.
- `/pricing` content includes Builder, Team, Business, Enterprise, `$15`, `$50`, `$99`.
- `/dashboard` anonymous -> `307` to Clerk sign-in.
- `POST /api/stripe/webhook` without Stripe signature -> `400`.

Database setup verification:

- Temporary audit DB: `mnemis_saas_audit_20260521`.
- `db:push:ci` passed.
- `seed:plans` passed.
- Seeded tiers: free, builder, team, business.

## Remaining Limits

- Browser-level Clerk login and Stripe Checkout card entry were not completed in this run because the interactive browser execution tool was not exposed in the active tool set, and this repo does not currently ship Playwright e2e tests. The server-side and persistence paths are covered by HTTP checks and DB-backed tests.
- The pricing UI still derives display prices from plan shape (`$15/$50/$99`) rather than reading amount/currency from Stripe or DB columns. This is acceptable for the current fixed tier set, but production polish should add explicit `amount`, `currency`, and `interval` columns or Stripe price metadata sync.
- Real Stripe webhook delivery from `stripe listen` was not re-triggered here; the webhook persistence logic is covered with deterministic DB tests and the route signature failure path is verified over HTTP.

## Status

The SaaS foundation is materially stronger after this audit. The blocking defects found in pricing rendering, tiered Stripe config, subscription idempotency and dashboard credit accounting have been fixed and verified.
