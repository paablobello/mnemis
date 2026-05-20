/**
 * Phase 3 integration tests: source registry, indexing job lifecycle and raw
 * chunk search. These tests intentionally seed chunks directly; the real
 * GitHub/docs indexers will own that write path in the next slice.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
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
const SOURCES_WRITE_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const SOURCES_WRITE_HASH = createHash('sha256').update(SOURCES_WRITE_KEY).digest('hex');
const SEARCH_READ_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const SEARCH_READ_HASH = createHash('sha256').update(SEARCH_READ_KEY).digest('hex');
const ORIGINAL_VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const ORIGINAL_RERANK_PROVIDER = process.env.MNEMIS_RERANK_PROVIDER;
const ORIGINAL_RERANK_MODEL = process.env.MNEMIS_RERANK_MODEL;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ALLOW_LOCAL_SOURCES = process.env.MNEMIS_ALLOW_LOCAL_SOURCES;
const ORIGINAL_LOCAL_SOURCE_ROOTS = process.env.MNEMIS_LOCAL_SOURCE_ROOTS;

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
  await db.insert(apiKeys).values({
    workspaceId,
    name: 'sources-write-no-local',
    keyHash: SOURCES_WRITE_HASH,
    prefix: SOURCES_WRITE_KEY.slice(0, 11),
    scopes: ['sources:write'],
  });
  await db.insert(apiKeys).values({
    workspaceId,
    name: 'search-read-no-content',
    keyHash: SEARCH_READ_HASH,
    prefix: SEARCH_READ_KEY.slice(0, 11),
    scopes: ['search:read'],
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
  if (ORIGINAL_ALLOW_LOCAL_SOURCES === undefined) {
    Reflect.deleteProperty(process.env, 'MNEMIS_ALLOW_LOCAL_SOURCES');
  } else {
    process.env.MNEMIS_ALLOW_LOCAL_SOURCES = ORIGINAL_ALLOW_LOCAL_SOURCES;
  }
  if (ORIGINAL_LOCAL_SOURCE_ROOTS === undefined) {
    Reflect.deleteProperty(process.env, 'MNEMIS_LOCAL_SOURCE_ROOTS');
  } else {
    process.env.MNEMIS_LOCAL_SOURCE_ROOTS = ORIGINAL_LOCAL_SOURCE_ROOTS;
  }
  if (ORIGINAL_RERANK_PROVIDER === undefined) {
    Reflect.deleteProperty(process.env, 'MNEMIS_RERANK_PROVIDER');
  } else {
    process.env.MNEMIS_RERANK_PROVIDER = ORIGINAL_RERANK_PROVIDER;
  }
  if (ORIGINAL_RERANK_MODEL === undefined) {
    Reflect.deleteProperty(process.env, 'MNEMIS_RERANK_MODEL');
  } else {
    process.env.MNEMIS_RERANK_MODEL = ORIGINAL_RERANK_MODEL;
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

  it('rejects localPath source config unless explicitly enabled', async () => {
    Reflect.deleteProperty(process.env, 'MNEMIS_ALLOW_LOCAL_SOURCES');
    try {
      const res = await app.request('/v1/sources', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          kind: 'github_repo',
          identifier: 'openai/local-path-blocked',
          config: { localPath: '/etc' },
          enqueue: false,
        }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'local_sources_disabled');
    } finally {
      if (ORIGINAL_ALLOW_LOCAL_SOURCES === undefined) {
        Reflect.deleteProperty(process.env, 'MNEMIS_ALLOW_LOCAL_SOURCES');
      } else {
        process.env.MNEMIS_ALLOW_LOCAL_SOURCES = ORIGINAL_ALLOW_LOCAL_SOURCES;
      }
    }
  });

  it('requires sources:local and redacts localPath from API responses and job payloads', async () => {
    process.env.MNEMIS_ALLOW_LOCAL_SOURCES = 'true';
    process.env.MNEMIS_LOCAL_SOURCE_ROOTS = tmpdir();
    try {
      const blocked = await app.request('/v1/sources', {
        method: 'POST',
        headers: headersFor(SOURCES_WRITE_KEY),
        body: JSON.stringify({
          kind: 'github_repo',
          identifier: 'openai/local-path-no-scope',
          config: { localPath: tmpdir() },
          enqueue: false,
        }),
      });
      assert.equal(blocked.status, 403);

      const allowed = await app.request('/v1/sources', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          kind: 'github_repo',
          identifier: 'openai/local-path-redacted',
          config: { localPath: tmpdir(), includePaths: ['src'] },
        }),
      });
      assert.equal(allowed.status, 201);
      const json = await allowed.json();
      assert.equal(json.data.config.localPathConfigured, true);
      assert.equal(json.data.config.localPath, undefined);
      assert.equal(json.job.payload.config.localPathConfigured, true);
      assert.equal(json.job.payload.config.localPath, undefined);
    } finally {
      if (ORIGINAL_ALLOW_LOCAL_SOURCES === undefined) {
        Reflect.deleteProperty(process.env, 'MNEMIS_ALLOW_LOCAL_SOURCES');
      } else {
        process.env.MNEMIS_ALLOW_LOCAL_SOURCES = ORIGINAL_ALLOW_LOCAL_SOURCES;
      }
      if (ORIGINAL_LOCAL_SOURCE_ROOTS === undefined) {
        Reflect.deleteProperty(process.env, 'MNEMIS_LOCAL_SOURCE_ROOTS');
      } else {
        process.env.MNEMIS_LOCAL_SOURCE_ROOTS = ORIGINAL_LOCAL_SOURCE_ROOTS;
      }
    }
  });

  it('requires cronSchedule when indexStrategy is cron', async () => {
    const missing = await app.request('/v1/sources', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'github_repo',
        identifier: 'openai/cron-missing',
        indexStrategy: 'cron',
      }),
    });
    assert.equal(missing.status, 400);
    const missingJson = await missing.json();
    assert.equal(missingJson.error, 'validation_error');

    const scheduled = await app.request('/v1/sources', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'github_repo',
        identifier: 'openai/cron-scheduled',
        indexStrategy: 'cron',
        cronSchedule: '*/15 * * * *',
        enqueue: false,
      }),
    });
    assert.equal(scheduled.status, 201);
    const scheduledJson = await scheduled.json();
    assert.equal(scheduledJson.data.index_strategy, 'cron');
    assert.equal(scheduledJson.data.cron_schedule, '*/15 * * * *');
    assert.equal(scheduledJson.job, null);
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
          'Contextual Retrieval adds a generated prefix to documentation chunks before full-text indexing and embedding.',
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

  it('requires search:content for content-bearing outputs', async () => {
    const raw = await app.request('/v1/search', {
      method: 'POST',
      headers: headersFor(SEARCH_READ_KEY),
      body: JSON.stringify({
        query: 'generated contextual prefix documentation retrieval',
        sourceIds: [docsSourceId],
        limit: 1,
      }),
    });
    assert.equal(raw.status, 200);
    const rawJson = await raw.json();
    assert.equal(rawJson.mode, 'raw');
    assert.equal('raw_text' in rawJson.items[0], false);

    const withContent = await app.request('/v1/search', {
      method: 'POST',
      headers: headersFor(SEARCH_READ_KEY),
      body: JSON.stringify({
        query: 'generated contextual prefix documentation retrieval',
        sourceIds: [docsSourceId],
        limit: 1,
        include: ['content'],
      }),
    });
    assert.equal(withContent.status, 403);
    const withContentJson = await withContent.json();
    assert.deepEqual(withContentJson.required_scopes, ['search:content']);

    const markdown = await app.request('/v1/search', {
      method: 'POST',
      headers: headersFor(SEARCH_READ_KEY),
      body: JSON.stringify({
        query: 'generated contextual prefix documentation retrieval',
        sourceIds: [docsSourceId],
        limit: 1,
        mode: 'markdown',
      }),
    });
    assert.equal(markdown.status, 403);
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

  it('returns numbered citations and permalinks in raw mode', async () => {
    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query: 'generated contextual prefix documentation retrieval',
        sourceIds: [docsSourceId],
        limit: 5,
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.mode, 'raw');
    assert.ok(Array.isArray(json.citations) && json.citations.length === json.items.length);
    assert.equal(json.citations[0].n, 1);
    assert.equal(json.items[0].permalink, 'https://docs.example.com/retrieval#contextual-prefixes');
    assert.equal(json.items[0].citation_number, 1);
  });

  it('expands child chunk matches to their parent chunk before rendering', async () => {
    const [parent] = await db
      .insert(chunks)
      .values({
        workspaceId,
        sourceId: docsSourceId,
        path: 'docs/large.md',
        lineStart: 1,
        lineEnd: 80,
        sectionPath: ['Large section'],
        rawText: 'Parent context for a large documentation section.',
        language: 'markdown',
        metadata: { retrieval_role: 'parent', chunk_key: 'docs/large.md:1:80:parent' },
      })
      .returning({ id: chunks.id });
    await db.insert(chunks).values({
      workspaceId,
      sourceId: docsSourceId,
      parentId: parent!.id,
      path: 'docs/large.md',
      lineStart: 35,
      lineEnd: 42,
      sectionPath: ['Large section'],
      rawText: 'NeedleChildTerm appears in a child chunk that should expand.',
      language: 'markdown',
      metadata: {
        retrieval_role: 'child',
        parent_key: 'docs/large.md:1:80:parent',
      },
    });

    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query: 'NeedleChildTerm',
        sourceIds: [docsSourceId],
        limit: 5,
        include: ['content'],
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.items[0].id, parent!.id);
    assert.equal(json.items[0].line_start, 1);
    assert.equal(json.items[0].line_end, 80);
    assert.match(json.items[0].raw_text, /Parent context/);
  });

  it('renders markdown mode with citations and permalinks', async () => {
    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query: 'contextual retrieval prefixes',
        sourceIds: [docsSourceId],
        limit: 3,
        mode: 'markdown',
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.mode, 'markdown');
    assert.equal(typeof json.markdown, 'string');
    assert.match(json.markdown, /\[1\]/);
    assert.match(json.markdown, /docs\/retrieval\.md/);
    assert.match(json.markdown, /docs\.example\.com\/retrieval#contextual-prefixes/);
    assert.ok(json.markdown.includes('```'));
  });

  it('builds github_repo permalinks from source.config.branch', async () => {
    const [repoSource] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'github_repo',
        identifier: 'mnemis-test/repo',
        displayName: 'Test repo',
        config: { branch: 'main' },
        status: 'indexed',
        lastIndexedAt: new Date('2026-05-19T10:00:00.000Z'),
      })
      .returning({ id: sources.id });
    await db.insert(chunks).values({
      workspaceId,
      sourceId: repoSource!.id,
      path: 'src/index.ts',
      lineStart: 42,
      lineEnd: 58,
      rawText: 'export function indexWorkspaceForRetrieval() { /* ... */ }',
      language: 'typescript',
    });

    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query: 'indexWorkspaceForRetrieval',
        sourceIds: [repoSource!.id],
        limit: 1,
        mode: 'markdown',
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(
      json.items[0].permalink,
      'https://github.com/mnemis-test/repo/blob/main/src/index.ts#L42-L58',
    );
    assert.match(
      json.markdown,
      /github\.com\/mnemis-test\/repo\/blob\/main\/src\/index\.ts#L42-L58/,
    );
  });

  it('prefers commit_sha in chunk metadata over branch for github permalinks', async () => {
    const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9001122334';
    const [shaSource] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'github_repo',
        identifier: 'mnemis-test/sha-repo',
        displayName: 'SHA repo',
        config: { branch: 'main' },
        status: 'indexed',
        lastIndexedAt: new Date('2026-05-20T10:00:00.000Z'),
      })
      .returning({ id: sources.id });
    await db.insert(chunks).values({
      workspaceId,
      sourceId: shaSource!.id,
      path: 'lib/handler.ts',
      lineStart: 10,
      lineEnd: 20,
      rawText: 'export function shaHandler() { /* pinned to a commit */ }',
      language: 'typescript',
      metadata: { commit_sha: sha },
    });

    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query: 'shaHandler',
        sourceIds: [shaSource!.id],
        limit: 1,
        mode: 'markdown',
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(
      json.items[0].permalink,
      `https://github.com/mnemis-test/sha-repo/blob/${sha}/lib/handler.ts#L10-L20`,
    );
  });

  it('returns 424 synthesis_unavailable when ANTHROPIC_API_KEY is missing', async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    Reflect.deleteProperty(process.env, 'ANTHROPIC_API_KEY');
    try {
      const res = await app.request('/v1/search', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          query: 'contextual retrieval',
          sourceIds: [docsSourceId],
          limit: 3,
          mode: 'synthesized',
        }),
      });
      assert.equal(res.status, 424);
      const json = await res.json();
      assert.equal(json.error, 'synthesis_unavailable');
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it('synthesizes an answer with citations when Anthropic is mocked', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    const previousFetch = globalThis.fetch;
    let capturedBody: { messages: Array<{ content: Array<{ text: string }> }> } | null = null;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://api.anthropic.com/')) {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: 'Contextual Retrieval prepends a generated prefix to each chunk [1].',
              },
            ],
            usage: { input_tokens: 120, output_tokens: 32 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return previousFetch(input, init);
    }) as typeof fetch;

    try {
      const res = await app.request('/v1/search', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          query: 'how does contextual retrieval work',
          sourceIds: [docsSourceId],
          limit: 3,
          mode: 'synthesized',
        }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.mode, 'synthesized');
      assert.match(json.answer, /\[1\]/);
      assert.equal(json.synthesis_model, 'claude-haiku-4-5');
      assert.equal(json.synthesis_usage.input_tokens, 120);
      assert.ok(capturedBody, 'expected Anthropic to be called');
      assert.match(
        capturedBody.messages[0]!.content[0]!.text,
        /how does contextual retrieval work/,
      );
      assert.match(capturedBody.messages[0]!.content[0]!.text, /Sources:/);
    } finally {
      globalThis.fetch = previousFetch;
      Reflect.deleteProperty(process.env, 'ANTHROPIC_API_KEY');
    }
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
    assert.equal(json.embedding_model, 'voyage-4-large');
    assert.equal(json.embedding_tokens, 1);
    assert.equal(json.items[0].path, 'docs/auth.md');
    assert.equal(json.items[0].ranks.bm25, null);
    assert.equal(json.items[0].ranks.vector, 1);
    assert.ok(json.items[0].vector_score > 0.99);

    unsetVoyageKey();
    resetEmbeddingsForTests();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('reranks source search results when Voyage reranking is enabled', async () => {
    const inserted = await db
      .insert(chunks)
      .values([
        {
          workspaceId,
          sourceId: docsSourceId,
          path: 'docs/rerank-a.md',
          lineStart: 1,
          lineEnd: 3,
          rawText: 'RerankTerm lower priority candidate.',
          language: 'markdown',
        },
        {
          workspaceId,
          sourceId: docsSourceId,
          path: 'docs/rerank-b.md',
          lineStart: 1,
          lineEnd: 3,
          rawText: 'RerankTerm higher priority candidate.',
          language: 'markdown',
        },
      ])
      .returning({ id: chunks.id });

    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    process.env.MNEMIS_RERANK_PROVIDER = 'voyage';
    resetEmbeddingsForTests();
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://api.voyageai.com/v1/rerank');
      const body = JSON.parse(String(init?.body)) as { documents: string[]; model: string };
      assert.equal(body.model, 'rerank-2.5');
      assert.equal(body.documents.length, 2);
      return new Response(
        JSON.stringify({
          data: [
            { index: 1, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.1 },
          ],
          usage: { total_tokens: 17 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query: 'RerankTerm',
        retrieval: 'keyword',
        sourceIds: [docsSourceId],
        pathPrefix: 'docs/rerank',
        limit: 2,
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.reranked, true);
    assert.equal(json.reranker_model, 'rerank-2.5');
    assert.equal(json.reranker_tokens, 17);
    assert.equal(json.items[0].id, inserted[1]!.id);

    unsetVoyageKey();
    Reflect.deleteProperty(process.env, 'MNEMIS_RERANK_PROVIDER');
    resetEmbeddingsForTests();
    globalThis.fetch = ORIGINAL_FETCH;
  });
});
