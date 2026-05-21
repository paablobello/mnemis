import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { apiKeys, createDatabase, eq, users, workspaces } from '@mnemis/db';
import { Hono } from 'hono';
// Side-effect import keeps the ContextVariableMap augmentation in scope.
import '../src/middleware/auth.ts';
import { rateLimit } from '../src/middleware/rate-limit.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required for integration tests');
if (!process.env.INTERNAL_AUTH_SECRET) process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const db = createDatabase({ url });

const TEST_SLUG = `rate-limit-${randomBytes(4).toString('hex')}`;
const TEST_EMAIL = `${TEST_SLUG}@mnemis.test`;
const RAW_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const KEY_HASH = createHash('sha256').update(RAW_KEY).digest('hex');
const ORIGINAL_MODE = process.env.MNEMIS_MODE;
const ORIGINAL_RATE = process.env.MNEMIS_RATE_LIMIT_PER_MINUTE;
const ORIGINAL_RATE_BACKEND = process.env.MNEMIS_RATE_LIMIT_BACKEND;
const ORIGINAL_TRUST_PROXY = process.env.MNEMIS_TRUST_PROXY;

let workspaceId = '';
let userId = '';
let apiKeyId = '';

function makeApp(): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth', { workspaceId, apiKeyId, scopes: ['*'] });
    await next();
  });
  app.use('*', rateLimit);
  app.get('/ping', (c) => c.json({ ok: true }));
  return app;
}

before(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: TEST_EMAIL, name: TEST_SLUG })
    .returning({ id: users.id });
  userId = user!.id;

  const [ws] = await db
    .insert(workspaces)
    .values({ slug: TEST_SLUG, name: TEST_SLUG, ownerId: userId })
    .returning({ id: workspaces.id });
  workspaceId = ws!.id;

  const [key] = await db
    .insert(apiKeys)
    .values({
      workspaceId,
      name: 'rate limit',
      keyHash: KEY_HASH,
      prefix: RAW_KEY.slice(0, 11),
      scopes: ['*'],
    })
    .returning({ id: apiKeys.id });
  apiKeyId = key!.id;
});

after(async () => {
  if (ORIGINAL_MODE === undefined) Reflect.deleteProperty(process.env, 'MNEMIS_MODE');
  else process.env.MNEMIS_MODE = ORIGINAL_MODE;
  if (ORIGINAL_RATE === undefined)
    Reflect.deleteProperty(process.env, 'MNEMIS_RATE_LIMIT_PER_MINUTE');
  else process.env.MNEMIS_RATE_LIMIT_PER_MINUTE = ORIGINAL_RATE;
  if (ORIGINAL_RATE_BACKEND === undefined)
    Reflect.deleteProperty(process.env, 'MNEMIS_RATE_LIMIT_BACKEND');
  else process.env.MNEMIS_RATE_LIMIT_BACKEND = ORIGINAL_RATE_BACKEND;
  if (ORIGINAL_TRUST_PROXY === undefined) Reflect.deleteProperty(process.env, 'MNEMIS_TRUST_PROXY');
  else process.env.MNEMIS_TRUST_PROXY = ORIGINAL_TRUST_PROXY;

  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('Postgres-backed rate limiting', () => {
  it('shares the same bucket across app instances', async () => {
    process.env.MNEMIS_RATE_LIMIT_BACKEND = 'postgres';
    process.env.MNEMIS_RATE_LIMIT_PER_MINUTE = '2';
    process.env.MNEMIS_TRUST_PROXY = 'true';

    const appA = makeApp();
    const appB = makeApp();
    const headers = { 'x-forwarded-for': '203.0.113.10' };

    const first = await appA.request('/ping', { headers });
    const second = await appB.request('/ping', { headers });
    const third = await appA.request('/ping', { headers });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('ratelimit-limit'), '2');
    assert.equal(third.headers.get('ratelimit-remaining'), '0');
    const json = await third.json();
    assert.equal(json.error, 'rate_limited');
  });
});
