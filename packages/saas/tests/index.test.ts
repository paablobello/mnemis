import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  createDatabase,
  eq,
  plans,
  sources,
  subscriptions,
  usageEvents,
  users,
  workspaces,
} from '@mnemis/db';
import {
  UNLIMITED_CREDITS_SENTINEL,
  billingPeriod,
  generateApiKey,
  getPlanForWorkspace,
  getUsageSummary,
  getWorkspaceCreditLimit,
  getWorkspaceSourceQuota,
  monthlyCreditLimit,
} from '../src/index.ts';

describe('saas helpers', () => {
  it('generates Mnemis API keys without exposing hashes as raw values', () => {
    const key = generateApiKey('test-secret');
    assert.match(key.raw, /^mn_[0-9a-f]{48}$/);
    assert.equal(key.prefix, key.raw.slice(0, 11));
    assert.notEqual(key.hash, key.raw);
    assert.match(key.hash, /^hmac_sha256:[0-9a-f]{64}$/);
  });

  it('uses UTC calendar months for SaaS billing periods', () => {
    const period = billingPeriod(new Date('2026-05-21T12:00:00.000Z'));
    assert.equal(period.start.toISOString(), '2026-05-01T00:00:00.000Z');
    assert.equal(period.end.toISOString(), '2026-06-01T00:00:00.000Z');
  });

  it('uses the configured monthly credit limit when present', () => {
    const previous = process.env.MNEMIS_FREE_MONTHLY_CREDITS;
    process.env.MNEMIS_FREE_MONTHLY_CREDITS = '2500';
    try {
      assert.equal(monthlyCreditLimit(), 2500);
    } finally {
      process.env.MNEMIS_FREE_MONTHLY_CREDITS = previous ?? '';
    }
  });

  it(
    'resolves the free plan when a workspace has no active subscription',
    { skip: !process.env.DATABASE_URL },
    async () => {
      const db = createDatabase({ url: process.env.DATABASE_URL!, max: 1, idleTimeout: 1 });
      const slug = `saas-plan-${randomBytes(4).toString('hex')}`;
      const [user] = await db
        .insert(users)
        .values({ email: `${slug}@mnemis.test`, name: slug })
        .returning({ id: users.id });
      const [workspace] = await db
        .insert(workspaces)
        .values({ slug, name: slug, ownerId: user!.id })
        .returning({ id: workspaces.id });

      try {
        const [freePlan] = await db.select().from(plans).where(eq(plans.id, 'free')).limit(1);
        if (!freePlan) {
          assert.fail('plans seed missing — run `bun run --filter=@mnemis/db seed:plans`');
        }
        const plan = await getPlanForWorkspace(db, workspace!.id);
        assert.equal(plan.id, 'free');
        const limit = await getWorkspaceCreditLimit(db, workspace!.id);
        assert.equal(limit, freePlan!.monthlyCredits);
      } finally {
        await db.delete(workspaces).where(eq(workspaces.id, workspace!.id));
        await db.delete(users).where(eq(users.id, user!.id));
      }
    },
  );

  it(
    'returns the active subscription plan and uncaps credit limit for unlimited tiers',
    { skip: !process.env.DATABASE_URL },
    async () => {
      const db = createDatabase({ url: process.env.DATABASE_URL!, max: 1, idleTimeout: 1 });
      const slug = `saas-plan-active-${randomBytes(4).toString('hex')}`;
      const [user] = await db
        .insert(users)
        .values({ email: `${slug}@mnemis.test`, name: slug })
        .returning({ id: users.id });
      const [workspace] = await db
        .insert(workspaces)
        .values({ slug, name: slug, ownerId: user!.id })
        .returning({ id: workspaces.id });

      try {
        const [business] = await db.select().from(plans).where(eq(plans.id, 'business')).limit(1);
        if (!business) assert.fail('business plan missing — run seed:plans');
        await db.insert(subscriptions).values({
          workspaceId: workspace!.id,
          planId: 'business',
          stripeSubscriptionId: `sub_test_${randomBytes(8).toString('hex')}`,
          stripePriceId: business!.stripePriceId ?? 'price_test',
          status: 'active',
        });

        const plan = await getPlanForWorkspace(db, workspace!.id);
        assert.equal(plan.id, 'business');
        assert.ok(plan.monthlyCredits >= UNLIMITED_CREDITS_SENTINEL);

        const limit = await getWorkspaceCreditLimit(db, workspace!.id);
        assert.equal(limit, Number.MAX_SAFE_INTEGER);
      } finally {
        await db.delete(subscriptions).where(eq(subscriptions.workspaceId, workspace!.id));
        await db.delete(workspaces).where(eq(workspaces.id, workspace!.id));
        await db.delete(users).where(eq(users.id, user!.id));
      }
    },
  );

  it(
    'counts workspace sources against the plan max in getWorkspaceSourceQuota',
    { skip: !process.env.DATABASE_URL },
    async () => {
      const db = createDatabase({ url: process.env.DATABASE_URL!, max: 1, idleTimeout: 1 });
      const slug = `saas-srcquota-${randomBytes(4).toString('hex')}`;
      const [user] = await db
        .insert(users)
        .values({ email: `${slug}@mnemis.test`, name: slug })
        .returning({ id: users.id });
      const [workspace] = await db
        .insert(workspaces)
        .values({ slug, name: slug, ownerId: user!.id })
        .returning({ id: workspaces.id });

      try {
        // free plan has max_sources = 3. Insert 2 sources.
        await db.insert(sources).values([
          {
            workspaceId: workspace!.id,
            kind: 'web_page',
            identifier: `https://example.com/${slug}/a`,
            displayName: 'a',
          },
          {
            workspaceId: workspace!.id,
            kind: 'web_page',
            identifier: `https://example.com/${slug}/b`,
            displayName: 'b',
          },
        ]);

        const quota = await getWorkspaceSourceQuota(db, workspace!.id);
        assert.equal(quota.used, 2);
        assert.equal(quota.max, 3);
      } finally {
        await db.delete(sources).where(eq(sources.workspaceId, workspace!.id));
        await db.delete(workspaces).where(eq(workspaces.id, workspace!.id));
        await db.delete(users).where(eq(users.id, user!.id));
      }
    },
  );

  it(
    'summarizes monthly credits from Postgres timestamps',
    { skip: !process.env.DATABASE_URL },
    async () => {
      const db = createDatabase({ url: process.env.DATABASE_URL!, max: 1, idleTimeout: 1 });
      const slug = `saas-usage-${randomBytes(4).toString('hex')}`;
      const [user] = await db
        .insert(users)
        .values({ email: `${slug}@mnemis.test`, name: slug })
        .returning({ id: users.id });
      const [workspace] = await db
        .insert(workspaces)
        .values({ slug, name: slug, ownerId: user!.id })
        .returning({ id: workspaces.id });

      try {
        await db.insert(usageEvents).values([
          {
            workspaceId: workspace!.id,
            kind: 'research',
            costCredits: 7,
            occurredAt: new Date('2026-05-10T12:00:00.000Z'),
          },
          {
            workspaceId: workspace!.id,
            kind: 'research',
            costCredits: 11,
            occurredAt: new Date('2026-06-10T12:00:00.000Z'),
          },
        ]);

        const summary = await getUsageSummary(
          db,
          workspace!.id,
          new Date('2026-05-21T12:00:00.000Z'),
        );
        assert.equal(summary.credits_used, 7);
        assert.equal(summary.requests, 1);
      } finally {
        await db.delete(workspaces).where(eq(workspaces.id, workspace!.id));
        await db.delete(users).where(eq(users.id, user!.id));
      }
    },
  );
});
