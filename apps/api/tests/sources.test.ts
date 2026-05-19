/**
 * Phase 3 integration tests: source registry, indexing job lifecycle and raw
 * chunk search. These tests intentionally seed chunks directly; the real
 * GitHub/docs indexers will own that write path in the next slice.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { apiKeys, chunks, createDatabase, sources, users, workspaces } from '@mnemis/db';
import { resetEmbeddingsForTests } from '@mnemis/embeddings';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required for integration tests');

if (!process.env.INTERNAL_AUTH_SECRET) process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const db = createDatabase({ url });
const app = createApp({ silent: true });

const TEST_SLUG = `sources-${randomBytes(4).toString('hex')}`;
const TEST_EMAIL = `${TEST_SLUG}@mnemis.test`;
const RAW_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const KEY_HASH = createHash('sha256').update(RAW_KEY).digest('hex');
const READ_ONLY_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const READ_ONLY_HASH = createHash('sha256').update(READ_ONLY_KEY).digest('hex');
const SOURCES_ONLY_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const SOURCES_ONLY_HASH = createHash('sha256').update(SOURCES_ONLY_KEY).digest('hex');
const ORIGINAL_VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

function unsetVoyageKey(): void {
  Reflect.deleteProperty(process.env, 'VOYAGE_API_KEY');
}

unsetVoyageKey();

let workspaceId = '';
let userId = '';
let otherWorkspaceId = '';
let otherUserId = '';

const headersFor = (key: string) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${key}`,
});

const headers = () => headersFor(RAW_KEY);

function unitVector(axis: number): number[] {
  return Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0));
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

  await db.insert(apiKeys).values({
    workspaceId,
    name: 'phase-3',
    keyHash: KEY_HASH,
    prefix: RAW_KEY.slice(0, 11),
    scopes: ['sources:*', 'search:*'],
  });
  await db.insert(apiKeys).values({
    workspaceId,
    name: 'sources-read',
    keyHash: READ_ONLY_HASH,
    prefix: READ_ONLY_KEY.slice(0, 11),
    scopes: ['sources:read'],
  });
  await db.insert(apiKeys).values({
    workspaceId,
    name: 'sources-only',
    keyHash: SOURCES_ONLY_HASH,
    prefix: SOURCES_ONLY_KEY.slice(0, 11),
    scopes: ['sources:*'],
  });

  const otherSlug = `${TEST_SLUG}-other`;
  const [otherUser] = await db
    .insert(users)
    .values({ email: `${otherSlug}@mnemis.test`, name: otherSlug })
    .returning({ id: users.id });
  otherUserId = otherUser!.id;
  const [otherWs] = await db
    .insert(workspaces)
    .values({ slug: otherSlug, name: otherSlug, ownerId: otherUserId })
    .returning({ id: workspaces.id });
  otherWorkspaceId = otherWs!.id;
});

after(async () => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_VOYAGE_API_KEY === undefined) {
    unsetVoyageKey();
  } else {
    process.env.VOYAGE_API_KEY = ORIGINAL_VOYAGE_API_KEY;
  }
  resetEmbeddingsForTests();

  await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
  await db.delete(users).where(eq(users.id, otherUserId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('sources API', () => {
  let sourceId = '';

  it('rejects writes without sources:write scope', async () => {
    const res = await app.request('/v1/sources', {
      method: 'POST',
      headers: headersFor(READ_ONLY_KEY),
      body: JSON.stringify({ kind: 'github_repo', identifier: 'owner/repo' }),
    });
    assert.equal(res.status, 403);
  });

  it('creates a GitHub source and queues an index job', async () => {
    const res = await app.request('/v1/sources', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'github_repo',
        identifier: 'OpenAI/Mnemis-Test',
        config: { branch: 'main', includePaths: ['apps/api'], excludePaths: ['node_modules'] },
        indexStrategy: 'webhook',
      }),
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    sourceId = json.data.id;
    assert.equal(json.data.identifier, 'openai/mnemis-test');
    assert.equal(json.data.status, 'pending');
    assert.equal(json.job.kind, 'index_source');
    assert.equal(json.job.status, 'queued');
    assert.equal(json.job.payload.source_id, sourceId);
  });

  it('rejects duplicate sources in the same workspace', async () => {
    const res = await app.request('/v1/sources', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ kind: 'github_repo', identifier: 'openai/mnemis-test' }),
    });
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.error, 'source_exists');
  });

  it('validates identifiers by source kind', async () => {
    const res = await app.request('/v1/sources', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ kind: 'docs_site', identifier: 'not-a-url' }),
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, 'validation_error');
  });

  it('lists and retrieves sources in the authenticated workspace', async () => {
    const list = await app.request('/v1/sources?kind=github_repo', { headers: headers() });
    assert.equal(list.status, 200);
    const listJson = await list.json();
    assert.ok(listJson.total >= 1);
    assert.ok(listJson.items.some((item: { id: string }) => item.id === sourceId));

    const get = await app.request(`/v1/sources/${sourceId}`, { headers: headers() });
    assert.equal(get.status, 200);
    const getJson = await get.json();
    assert.equal(getJson.data.id, sourceId);

    const missing = await app.request(`/v1/sources/${sourceId}`, {
      headers: headersFor(READ_ONLY_KEY.replace('mn_test_', 'mn_bogus_')),
    });
    assert.equal(missing.status, 401);
  });

  it('returns source status with latest job and chunk count', async () => {
    const status = await app.request(`/v1/sources/${sourceId}/status`, { headers: headers() });
    assert.equal(status.status, 200);
    const json = await status.json();
    assert.equal(json.source.id, sourceId);
    assert.equal(json.chunk_count, 0);
    assert.equal(json.latest_job.kind, 'index_source');
  });

  it('queues a reindex job', async () => {
    const res = await app.request(`/v1/sources/${sourceId}/reindex`, {
      method: 'POST',
      headers: headers(),
    });
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.equal(json.job.kind, 'reindex_source');
    assert.equal(json.job.payload.source_id, sourceId);

    const status = await app.request(`/v1/sources/${sourceId}/status`, { headers: headers() });
    const statusJson = await status.json();
    assert.equal(statusJson.latest_job.kind, 'reindex_source');
  });
});

describe('source chunk search', () => {
  let docsSourceId = '';

  before(async () => {
    const create = await app.request('/v1/sources', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'docs_site',
        identifier: 'https://docs.example.com/',
        displayName: 'Example Docs',
        enqueue: false,
      }),
    });
    assert.equal(create.status, 201);
    docsSourceId = (await create.json()).data.id;

    await db
      .update(sources)
      .set({
        status: 'indexed',
        statusMessage: null,
        lastIndexedAt: new Date('2026-05-16T09:00:00.000Z'),
      })
      .where(eq(sources.id, docsSourceId));

    await db.insert(chunks).values([
      {
        workspaceId,
        sourceId: docsSourceId,
        path: 'docs/retrieval.md',
        lineStart: 10,
        lineEnd: 24,
        sectionPath: ['Retrieval', 'Contextual prefixes'],
        rawText:
          'Contextual Retrieval adds a generated prefix to documentation chunks before BM25 indexing and embedding.',
        contextualPrefix:
          'This section explains how Mnemis improves documentation retrieval quality.',
        language: 'markdown',
        embedding: unitVector(0),
        metadata: { permalink: 'https://docs.example.com/retrieval#contextual-prefixes' },
      },
      {
        workspaceId,
        sourceId: docsSourceId,
        path: 'docs/auth.md',
        lineStart: 1,
        lineEnd: 12,
        sectionPath: ['Authentication'],
        rawText: 'API keys use sha256 hashes and route scopes for machine authentication.',
        language: 'markdown',
        embedding: unitVector(1),
      },
    ]);

    const [otherSource] = await db
      .insert(sources)
      .values({
        workspaceId: otherWorkspaceId,
        kind: 'docs_site',
        identifier: 'https://other.example.com',
        displayName: 'Other Docs',
        status: 'indexed',
        lastIndexedAt: new Date('2026-05-16T10:00:00.000Z'),
      })
      .returning({ id: sources.id });
    await db.insert(chunks).values({
      workspaceId: otherWorkspaceId,
      sourceId: otherSource!.id,
      path: 'docs/retrieval.md',
      lineStart: 1,
      lineEnd: 4,
      rawText: 'Contextual Retrieval from another workspace must never leak.',
      language: 'markdown',
    });
  });

  it('requires search scope', async () => {
    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headersFor(SOURCES_ONLY_KEY),
      body: JSON.stringify({ query: 'contextual retrieval', limit: 5 }),
    });
    assert.equal(res.status, 403);
  });

  it('returns raw chunks with citations and freshness metadata', async () => {
    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query: 'generated contextual prefix documentation retrieval',
        sourceIds: [docsSourceId],
        limit: 5,
        include: ['content', 'metadata'],
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.mode, 'raw');
    assert.equal(json.retrieval, 'keyword_only');
    assert.equal(json.used_vector, false);
    assert.ok(json.count >= 1);

    const first = json.items[0];
    assert.equal(first.source_id, docsSourceId);
    assert.equal(first.source_kind, 'docs_site');
    assert.equal(first.path, 'docs/retrieval.md');
    assert.equal(first.line_start, 10);
    assert.equal(first.line_end, 24);
    assert.equal(first.last_indexed_at, '2026-05-16T09:00:00.000Z');
    assert.equal(first.ranks.bm25, 1);
    assert.equal(first.ranks.vector, null);
    assert.match(first.raw_text, /Contextual Retrieval/);
    assert.equal(
      first.metadata.permalink,
      'https://docs.example.com/retrieval#contextual-prefixes',
    );
  });

  it('does not leak chunks from other workspaces', async () => {
    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query: 'must never leak contextual retrieval', limit: 10 }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(
      json.items.every(
        (item: { source_identifier: string }) =>
          item.source_identifier !== 'https://other.example.com',
      ),
    );
  });

  it('uses vector retrieval when embeddings are configured', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    resetEmbeddingsForTests();
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(
        JSON.stringify({
          data: body.input.map((_text, index) => ({ index, embedding: unitVector(1) })),
          usage: { total_tokens: body.input.length },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query: 'credential permission security',
        retrieval: 'hybrid',
        sourceIds: [docsSourceId],
        limit: 2,
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.retrieval, 'hybrid_rrf');
    assert.equal(json.used_vector, true);
    assert.equal(json.embedding_model, 'voyage-3.5-large');
    assert.equal(json.embedding_tokens, 1);
    assert.equal(json.items[0].path, 'docs/auth.md');
    assert.equal(json.items[0].ranks.bm25, null);
    assert.equal(json.items[0].ranks.vector, 1);
    assert.ok(json.items[0].vector_score > 0.99);

    unsetVoyageKey();
    resetEmbeddingsForTests();
    globalThis.fetch = ORIGINAL_FETCH;
  });
});
