import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { createDatabase, eq, usageEvents, users, workspaces } from '@mnemis/db';
import {
  billingPeriod,
  generateApiKey,
  getUsageSummary,
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
