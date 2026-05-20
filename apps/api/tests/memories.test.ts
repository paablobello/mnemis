/**
 * Integration tests that exercise the real Hono app + real Postgres.
 *
 *   Prereq: docker-compose stack running, DATABASE_URL exported.
 *   Run:    bun --filter @mnemis/api test
 *
 * Tests do NOT mock anything — they hit the actual database. Each test
 * uses an isolated workspace bootstrapped at module load and torn down at
 * the end (cascade deletes the rows). Embeddings are *expected* to be
 * disabled (no VOYAGE_API_KEY in CI), so the tests assert the Postgres full-text path
 * and the graceful-fallback behaviour of /semantic-search.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { apiKeyHash, apiKeys, createDatabase, memories, users, workspaces } from '@mnemis/db';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../src/app.ts';
import { resetRateLimitForTests } from '../src/middleware/rate-limit.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required for integration tests');

if (!process.env.INTERNAL_AUTH_SECRET) process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const db = createDatabase({ url });
const app = createApp({ silent: true });

const TEST_SLUG = `test-${randomBytes(4).toString('hex')}`;
const TEST_EMAIL = `${TEST_SLUG}@mnemis.test`;
const RAW_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const KEY_HASH = createHash('sha256').update(RAW_KEY).digest('hex');
const READ_ONLY_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const READ_ONLY_HASH = createHash('sha256').update(READ_ONLY_KEY).digest('hex');
const HMAC_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const DELETE_ONLY_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const DELETE_ONLY_HASH = createHash('sha256').update(DELETE_ONLY_KEY).digest('hex');
const ORIGINAL_MAX_BODY_BYTES = process.env.MNEMIS_MAX_BODY_BYTES;
const ORIGINAL_RATE_LIMIT = process.env.MNEMIS_RATE_LIMIT_PER_MINUTE;

let workspaceId = '';
let userId = '';

const headers = () => ({
  'content-type': 'application/json',
  authorization: `Bearer ${RAW_KEY}`,
});

const headersFor = (key: string) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${key}`,
});

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
  await db.insert(apiKeys).values({
    workspaceId,
    name: 'test',
    keyHash: KEY_HASH,
    prefix: RAW_KEY.slice(0, 11),
    scopes: ['memories:*', 'search:*', 'admin:*'],
  });
  await db.insert(apiKeys).values({
    workspaceId,
    name: 'read-only',
    keyHash: READ_ONLY_HASH,
    prefix: READ_ONLY_KEY.slice(0, 11),
    scopes: ['memories:read'],
  });
  await db.insert(apiKeys).values({
    workspaceId,
    name: 'hmac-read',
    keyHash: apiKeyHash(HMAC_KEY, process.env.INTERNAL_AUTH_SECRET),
    prefix: HMAC_KEY.slice(0, 11),
    scopes: ['memories:read'],
  });
  await db.insert(apiKeys).values({
    workspaceId,
    name: 'delete-only',
    keyHash: DELETE_ONLY_HASH,
    prefix: DELETE_ONLY_KEY.slice(0, 11),
    scopes: ['memories:delete'],
  });
});

after(async () => {
  resetRateLimitForTests();
  if (ORIGINAL_MAX_BODY_BYTES === undefined) {
    Reflect.deleteProperty(process.env, 'MNEMIS_MAX_BODY_BYTES');
  } else {
    process.env.MNEMIS_MAX_BODY_BYTES = ORIGINAL_MAX_BODY_BYTES;
  }
  if (ORIGINAL_RATE_LIMIT === undefined) {
    Reflect.deleteProperty(process.env, 'MNEMIS_RATE_LIMIT_PER_MINUTE');
  } else {
    process.env.MNEMIS_RATE_LIMIT_PER_MINUTE = ORIGINAL_RATE_LIMIT;
  }
  // workspaces cascades to api_keys + memories
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('auth', () => {
  it('rejects missing key', async () => {
    const res = await app.request('/v1/memories');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'missing_credentials');
  });

  it('rejects unknown key', async () => {
    const res = await app.request('/v1/memories', {
      headers: { authorization: 'Bearer mn_bogus' },
    });
    assert.equal(res.status, 401);
  });

  it('accepts valid key', async () => {
    const res = await app.request('/v1/memories', { headers: headers() });
    assert.equal(res.status, 200);
  });

  it('accepts HMAC-derived API key hashes', async () => {
    const res = await app.request('/v1/memories', { headers: headersFor(HMAC_KEY) });
    assert.equal(res.status, 200);
  });

  it('rejects keys without the required scope', async () => {
    const write = await app.request('/v1/memories', {
      method: 'POST',
      headers: headersFor(READ_ONLY_KEY),
      body: JSON.stringify({
        kind: 'fact',
        title: 'scope check',
        summary: 'scope check',
        body: 'this write must be rejected',
      }),
    });
    assert.equal(write.status, 403);
    const body = await write.json();
    assert.equal(body.error, 'insufficient_scope');

    const read = await app.request('/v1/memories', { headers: headersFor(READ_ONLY_KEY) });
    assert.equal(read.status, 200);
  });

  it('rejects oversized bodies before auth and rate limits authenticated keys', async () => {
    process.env.MNEMIS_MAX_BODY_BYTES = '8';
    const oversizedBody = JSON.stringify({ body: 'too large' });
    const oversized = await app.request('/v1/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(oversizedBody)),
      },
      body: oversizedBody,
    });
    assert.equal(oversized.status, 413);
    const oversizedJson = await oversized.json();
    assert.equal(oversizedJson.error, 'payload_too_large');

    resetRateLimitForTests();
    process.env.MNEMIS_RATE_LIMIT_PER_MINUTE = '1';
    const first = await app.request('/v1/memories', { headers: headers() });
    const second = await app.request('/v1/memories', { headers: headers() });
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    const rateJson = await second.json();
    assert.equal(rateJson.error, 'rate_limited');

    resetRateLimitForTests();
    if (ORIGINAL_MAX_BODY_BYTES === undefined) {
      Reflect.deleteProperty(process.env, 'MNEMIS_MAX_BODY_BYTES');
    } else {
      process.env.MNEMIS_MAX_BODY_BYTES = ORIGINAL_MAX_BODY_BYTES;
    }
    if (ORIGINAL_RATE_LIMIT === undefined) {
      Reflect.deleteProperty(process.env, 'MNEMIS_RATE_LIMIT_PER_MINUTE');
    } else {
      process.env.MNEMIS_RATE_LIMIT_PER_MINUTE = ORIGINAL_RATE_LIMIT;
    }
  });
});

describe('memories CRUD', () => {
  let id = '';

  it('POST creates with default ttl by kind', async () => {
    const res = await app.request('/v1/memories', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'working',
        title: 'tcrud title',
        summary: 'tcrud summary',
        body: 'tcrud body has tokens like vector hybrid retrieval mnemis',
        tags: ['itest'],
      }),
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    id = json.data.id;
    assert.equal(json.data.kind, 'working');
    assert.equal(json.data.ttl_seconds, 3600);
    assert.ok(json.data.expires_at);
    assert.equal(json.data.archived_at, null);
    assert.equal(json.data.has_embedding, false); // VOYAGE_API_KEY not set
    // lineage included on POST response
    assert.deepEqual(json.data.lineage.source_ids, []);
  });

  it('POST with kind=fact has null ttl (permanent)', async () => {
    const res = await app.request('/v1/memories', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'fact',
        title: 'permanent',
        summary: 'permanent fact',
        body: 'this never expires',
        tags: ['itest'],
      }),
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.ttl_seconds, null);
    assert.equal(json.data.expires_at, null);
  });

  it('GET retrieves with ?include=lineage', async () => {
    const res = await app.request(`/v1/memories/${id}?include=lineage`, { headers: headers() });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.id, id);
    assert.ok(json.data.lineage);
  });

  it('requires memories:embedding before returning stored vectors', async () => {
    const res = await app.request(`/v1/memories/${id}?include=embedding`, {
      headers: headersFor(READ_ONLY_KEY),
    });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error, 'insufficient_scope');
    assert.deepEqual(json.required_scopes, ['memories:embedding']);
  });

  it('GET 404 on unknown id', async () => {
    const res = await app.request(`/v1/memories/${randomUUID()}`, { headers: headers() });
    assert.equal(res.status, 404);
  });

  it('LIST returns the inserted memories filtered by tag', async () => {
    const res = await app.request('/v1/memories?tag=itest&limit=10', { headers: headers() });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.total >= 2);
    assert.ok(json.items.every((m: { tags: string[] }) => m.tags.includes('itest')));
  });

  it('PATCH metadata mutates tags + metadata', async () => {
    const res = await app.request(`/v1/memories/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ tags: ['itest', 'patched'], metadata: { reviewed: true } }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json.data.tags.sort(), ['itest', 'patched']);
    assert.deepEqual(json.data.metadata, { reviewed: true });
  });

  it('PATCH body is rejected by zod (ADD-only spirit)', async () => {
    const res = await app.request(`/v1/memories/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ body: 'should not be allowed' }),
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, 'validation_error');
  });

  it('DELETE soft-archives the memory', async () => {
    const res = await app.request(`/v1/memories/${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    assert.equal(res.status, 204);

    const list = await app.request('/v1/memories?tag=patched', { headers: headers() });
    const listJson = await list.json();
    assert.equal(listJson.total, 0);

    const archived = await app.request('/v1/memories?tag=patched&include_archived=true', {
      headers: headers(),
    });
    const archJson = await archived.json();
    assert.equal(archJson.total, 1);
    assert.ok(archJson.items[0].archived_at !== null);
  });

  it('requires explicit permanent-delete scope for hard deletes', async () => {
    const create = await app.request('/v1/memories', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'fact',
        title: 'hard delete guard',
        summary: 'hard delete guard',
        body: 'permanent delete should require a narrower scope',
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json();

    const blocked = await app.request(`/v1/memories/${created.data.id}?permanent=true`, {
      method: 'DELETE',
      headers: headersFor(DELETE_ONLY_KEY),
    });
    assert.equal(blocked.status, 403);
    const blockedJson = await blocked.json();
    assert.deepEqual(blockedJson.required_scopes, ['memories:delete:permanent']);

    const allowed = await app.request(`/v1/memories/${created.data.id}?permanent=true`, {
      method: 'DELETE',
      headers: headers(),
    });
    assert.equal(allowed.status, 204);
  });
});

describe('keyword search', () => {
  before(async () => {
    // seed a few topical memories
    const items = [
      {
        kind: 'fact',
        title: 'pgvector hybrid',
        summary: 'vector db',
        body: 'Postgres pgvector HNSW with tsvector full-text search fused via Reciprocal Rank Fusion',
        tags: ['stest', 'arch'],
      },
      {
        kind: 'fact',
        title: 'voyage embeddings',
        summary: 'embedding selection',
        body: 'voyage-3.5-large 1024 dims is the cloud default model for memories',
        tags: ['stest', 'embeddings'],
      },
      {
        kind: 'fact',
        title: 'unrelated cooking',
        summary: 'recipe',
        body: 'How to slow cook beans with garlic and bay leaf',
        tags: ['stest'],
      },
    ];
    for (const it of items) {
      await app.request('/v1/memories', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(it),
      });
    }
  });

  it('finds the pgvector memory with Postgres full-text search', async () => {
    const res = await app.request('/v1/memories/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query: 'pgvector reciprocal rank fusion', limit: 5 }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.mode, 'keyword');
    assert.ok(json.count >= 1);
    assert.equal(json.items[0].memory.title, 'pgvector hybrid');
    assert.ok(json.items[0].bm25_score > 0);
    assert.equal(json.items[0].ranks.bm25, 1);
  });

  it('supports tag filter', async () => {
    const res = await app.request('/v1/memories/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query: 'cook beans', tags: ['arch'], limit: 5 }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    // recipe is tagged 'stest' only, not 'arch' — filter should drop it
    assert.equal(json.count, 0);
  });
});

describe('semantic-search graceful fallback', () => {
  it('falls back to keyword_only when VOYAGE_API_KEY is absent', async () => {
    const res = await app.request('/v1/memories/semantic-search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query: 'pgvector reciprocal', limit: 3 }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.mode, 'keyword_only');
    assert.equal(json.embedding_model, null);
    assert.ok(json.count >= 1);
  });
});

describe('TTL sweep', () => {
  it('requires admin scope', async () => {
    const sweep = await app.request('/v1/admin/sweep', {
      method: 'POST',
      headers: headersFor(READ_ONLY_KEY),
    });
    assert.equal(sweep.status, 403);
  });

  it('archives a memory whose expires_at is in the past', async () => {
    // Create a working memory then forcibly backdate created_at so expires_at < now()
    const create = await app.request('/v1/memories', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'working',
        title: 'will expire',
        summary: 'expired by sweep',
        body: 'short-lived working note',
        tags: ['ttl'],
        ttlSeconds: 1,
      }),
    });
    const created = await create.json();
    const id: string = created.data.id;

    // Force created_at into the past so expires_at follows (the trigger
    // recomputes expires_at on UPDATE OF created_at)
    await db
      .update(memories)
      .set({ createdAt: sql`now() - interval '1 hour'` })
      .where(eq(memories.id, id));

    const sweep = await app.request('/v1/admin/sweep', { method: 'POST', headers: headers() });
    assert.equal(sweep.status, 200);
    const sweepJson = await sweep.json();
    assert.ok(sweepJson.archived >= 1);

    const fetched = await app.request(`/v1/memories/${id}?include=lineage`, { headers: headers() });
    const fetchedJson = await fetched.json();
    assert.ok(fetchedJson.data.archived_at !== null);
  });

  it('only sweeps expired memories in the authenticated workspace', async () => {
    const otherSlug = `other-${randomBytes(4).toString('hex')}`;
    const [otherUser] = await db
      .insert(users)
      .values({ email: `${otherSlug}@mnemis.test`, name: otherSlug })
      .returning({ id: users.id });
    const [otherWs] = await db
      .insert(workspaces)
      .values({ slug: otherSlug, name: otherSlug, ownerId: otherUser!.id })
      .returning({ id: workspaces.id });

    try {
      const [otherMemory] = await db
        .insert(memories)
        .values({
          workspaceId: otherWs!.id,
          kind: 'working',
          title: 'other expired',
          summary: 'other expired',
          body: 'this belongs to another workspace',
          ttlSeconds: 1,
          createdAt: sql`now() - interval '1 hour'`,
        })
        .returning({ id: memories.id });

      const sweep = await app.request('/v1/admin/sweep', { method: 'POST', headers: headers() });
      assert.equal(sweep.status, 200);

      const [row] = await db
        .select({ archivedAt: memories.archivedAt })
        .from(memories)
        .where(eq(memories.id, otherMemory!.id))
        .limit(1);
      assert.equal(row!.archivedAt, null);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, otherWs!.id));
      await db.delete(users).where(eq(users.id, otherUser!.id));
    }
  });
});
