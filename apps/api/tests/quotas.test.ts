import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { createDatabase, eq, sources, users, workspaces } from '@mnemis/db';
import { ApiError } from '../src/errors.ts';
import { assertSourceQuota } from '../src/services/quotas.ts';

const url = process.env.DATABASE_URL;
const ORIGINAL_ENFORCE = process.env.MNEMIS_ENFORCE_CREDITS;

afterEach(() => {
  if (ORIGINAL_ENFORCE === undefined) Reflect.deleteProperty(process.env, 'MNEMIS_ENFORCE_CREDITS');
  else process.env.MNEMIS_ENFORCE_CREDITS = ORIGINAL_ENFORCE;
});

describe('assertSourceQuota', () => {
  it('does not enforce when MNEMIS_ENFORCE_CREDITS is unset', async () => {
    process.env.MNEMIS_ENFORCE_CREDITS = '';
    // workspaceId can be invalid; the early-return short-circuits before any query.
    await assert.doesNotReject(assertSourceQuota('00000000-0000-0000-0000-000000000000'));
  });

  it('rejects when a free workspace is already at max_sources', { skip: !url }, async () => {
    process.env.MNEMIS_ENFORCE_CREDITS = 'true';
    const db = createDatabase({ url: url!, max: 1, idleTimeout: 1 });
    const slug = `quota-${randomBytes(4).toString('hex')}`;
    const [user] = await db
      .insert(users)
      .values({ email: `${slug}@mnemis.test`, name: slug })
      .returning({ id: users.id });
    const [workspace] = await db
      .insert(workspaces)
      .values({ slug, name: slug, ownerId: user!.id })
      .returning({ id: workspaces.id });

    try {
      // Free plan has max_sources = 3. Insert 3 to hit the cap.
      await db.insert(sources).values(
        Array.from({ length: 3 }, (_, i) => ({
          workspaceId: workspace!.id,
          kind: 'web_page' as const,
          identifier: `https://example.com/${slug}/${i}`,
          displayName: `s${i}`,
        })),
      );

      await assert.rejects(assertSourceQuota(workspace!.id), (err) => {
        if (!(err instanceof ApiError)) return false;
        assert.equal(err.status, 402);
        assert.equal(err.code, 'sources_quota_exhausted');
        return true;
      });

      // Allow when under the cap.
      await db.delete(sources).where(eq(sources.workspaceId, workspace!.id));
      await assert.doesNotReject(assertSourceQuota(workspace!.id));
    } finally {
      await db.delete(sources).where(eq(sources.workspaceId, workspace!.id));
      await db.delete(workspaces).where(eq(workspaces.id, workspace!.id));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });
});
