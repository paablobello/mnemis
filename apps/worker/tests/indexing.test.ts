import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { chunks, createDatabase, eq, jobs, sources, sql, users, workspaces } from '@mnemis/db';
import { resetEmbeddingsForTests } from '@mnemis/embeddings';
import { cronHasDueMinute, enqueueDueCronJobs } from '../src/cron.ts';
import { processOneJob } from '../src/runner.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required for integration tests');

const db = createDatabase({ url });

const TEST_SLUG = `worker-${randomBytes(4).toString('hex')}`;
const TEST_EMAIL = `${TEST_SLUG}@mnemis.test`;
const ORIGINAL_VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_ANTHROPIC_CONTEXT_MODEL = process.env.ANTHROPIC_CONTEXT_MODEL;
const ORIGINAL_ALLOW_LOCAL_SOURCES = process.env.MNEMIS_ALLOW_LOCAL_SOURCES;
const ORIGINAL_FETCH = globalThis.fetch;
const CLAIM_FIRST = new Date('2000-01-01T00:00:00.000Z');

function unsetVoyageKey(): void {
  Reflect.deleteProperty(process.env, 'VOYAGE_API_KEY');
}

function unsetAnthropicKey(): void {
  Reflect.deleteProperty(process.env, 'ANTHROPIC_API_KEY');
}

unsetVoyageKey();
unsetAnthropicKey();
Reflect.deleteProperty(process.env, 'ANTHROPIC_CONTEXT_MODEL');

let workspaceId = '';
let userId = '';
let repoRoot = '';

function unitVector(axis: number): number[] {
  return Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0));
}

function html(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'last-modified': 'Tue, 19 May 2026 10:00:00 GMT',
    },
  });
}

before(async () => {
  process.env.MNEMIS_ALLOW_LOCAL_SOURCES = 'true';

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

  repoRoot = join(tmpdir(), `mnemis-worker-${randomBytes(4).toString('hex')}`);
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await mkdir(join(repoRoot, 'node_modules', 'ignored'), { recursive: true });
  await writeFile(
    join(repoRoot, 'src', 'retrieval.ts'),
    [
      'export function contextualRetrieval() {',
      "  return 'generated contextual prefix for better retrieval';",
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(repoRoot, 'README.md'),
    '# Mnemis Fixture\n\nHybrid search combines BM25 and vector rankings with RRF.\n',
  );
  await writeFile(join(repoRoot, 'node_modules', 'ignored', 'bad.js'), 'must never be indexed');
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  unsetVoyageKey();
  unsetAnthropicKey();
  Reflect.deleteProperty(process.env, 'ANTHROPIC_CONTEXT_MODEL');
  resetEmbeddingsForTests();
});

after(async () => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_VOYAGE_API_KEY === undefined) {
    unsetVoyageKey();
  } else {
    process.env.VOYAGE_API_KEY = ORIGINAL_VOYAGE_API_KEY;
  }
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
    unsetAnthropicKey();
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
  }
  if (ORIGINAL_ANTHROPIC_CONTEXT_MODEL === undefined) {
    Reflect.deleteProperty(process.env, 'ANTHROPIC_CONTEXT_MODEL');
  } else {
    process.env.ANTHROPIC_CONTEXT_MODEL = ORIGINAL_ANTHROPIC_CONTEXT_MODEL;
  }
  if (ORIGINAL_ALLOW_LOCAL_SOURCES === undefined) {
    Reflect.deleteProperty(process.env, 'MNEMIS_ALLOW_LOCAL_SOURCES');
  } else {
    process.env.MNEMIS_ALLOW_LOCAL_SOURCES = ORIGINAL_ALLOW_LOCAL_SOURCES;
  }
  resetEmbeddingsForTests();

  await rm(repoRoot, { recursive: true, force: true });
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('index worker', () => {
  it('detects due cron minutes with standard 5-field expressions', () => {
    assert.equal(
      cronHasDueMinute(
        '*/15 * * * *',
        new Date('2026-05-20T10:00:00.000Z'),
        new Date('2026-05-20T10:15:30.000Z'),
      ),
      true,
    );
    assert.equal(
      cronHasDueMinute(
        '0 3 * * *',
        new Date('2026-05-20T03:00:00.000Z'),
        new Date('2026-05-20T03:59:59.000Z'),
      ),
      false,
    );
  });

  it('queues due cron reindex jobs without duplicating open jobs', async () => {
    const anchor = new Date('2026-05-20T10:00:00.000Z');
    const now = new Date('2026-05-20T10:15:30.000Z');
    const [source] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'github_repo',
        identifier: 'mnemis/cron-fixture',
        displayName: 'cron fixture',
        config: {},
        indexStrategy: 'cron',
        cronSchedule: '*/15 * * * *',
        status: 'indexed',
        createdAt: anchor,
        lastIndexedAt: anchor,
      })
      .returning();

    assert.equal(await enqueueDueCronJobs(db, now), 1);
    assert.equal(await enqueueDueCronJobs(db, now), 0);

    const rows = await db
      .select()
      .from(jobs)
      .where(sql`${jobs.payload}->>'source_id' = ${source!.id}`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, 'reindex_source');
    assert.equal(rows[0]!.status, 'queued');
  });

  it('fails localPath jobs unless local sources are explicitly enabled', async () => {
    const [source] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'github_repo',
        identifier: 'mnemis/local-disabled-fixture',
        displayName: 'local disabled fixture',
        config: { localPath: repoRoot, includePaths: ['README.md'] },
        status: 'pending',
      })
      .returning();

    const [job] = await db
      .insert(jobs)
      .values({
        workspaceId,
        kind: 'index_source',
        payload: { source_id: source!.id },
        scheduledAt: CLAIM_FIRST,
      })
      .returning();

    Reflect.deleteProperty(process.env, 'MNEMIS_ALLOW_LOCAL_SOURCES');
    try {
      const processed = await processOneJob(db);
      assert.equal(processed, true);
    } finally {
      process.env.MNEMIS_ALLOW_LOCAL_SOURCES = 'true';
    }

    const [updatedSource] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, source!.id))
      .limit(1);
    const [updatedJob] = await db.select().from(jobs).where(eq(jobs.id, job!.id)).limit(1);

    assert.equal(updatedSource!.status, 'failed');
    assert.match(updatedSource!.statusMessage ?? '', /local_sources_disabled/);
    assert.equal(updatedJob!.status, 'failed');
    assert.match(updatedJob!.error ?? '', /local_sources_disabled/);
  });

  it('claims a queued source job, indexes local files and completes state', async () => {
    const [source] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'github_repo',
        identifier: 'mnemis/local-fixture',
        displayName: 'local fixture',
        config: {
          localPath: repoRoot,
          includePaths: ['src', 'README.md'],
          chunkMaxChars: 1_000,
        },
        status: 'pending',
      })
      .returning();

    const [job] = await db
      .insert(jobs)
      .values({
        workspaceId,
        kind: 'index_source',
        payload: { source_id: source!.id },
        scheduledAt: CLAIM_FIRST,
      })
      .returning();

    const processed = await processOneJob(db);
    assert.equal(processed, true);

    const [updatedSource] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, source!.id))
      .limit(1);
    assert.equal(updatedSource!.status, 'indexed');
    assert.equal(updatedSource!.statusMessage, null);
    assert.ok(updatedSource!.lastIndexedAt);
    assert.ok(updatedSource!.lastChangeAt);

    const [updatedJob] = await db.select().from(jobs).where(eq(jobs.id, job!.id)).limit(1);
    assert.equal(updatedJob!.status, 'completed');
    assert.equal((updatedJob!.result as { files: number }).files, 2);
    assert.equal((updatedJob!.result as { chunks: number }).chunks, 2);

    const indexedChunks = await db.select().from(chunks).where(eq(chunks.sourceId, source!.id));
    assert.equal(indexedChunks.length, 2);
    assert.ok(indexedChunks.some((chunk) => chunk.path === 'src/retrieval.ts'));
    assert.ok(indexedChunks.some((chunk) => chunk.path === 'README.md'));
    assert.ok(!indexedChunks.some((chunk) => chunk.path.includes('node_modules')));

    const fts = await db
      .select({ id: chunks.id })
      .from(chunks)
      .where(sql`${chunks.bodyTsv} @@ websearch_to_tsquery('english', ${'contextual prefix'})`);
    assert.ok(fts.length >= 1);
  });

  it('deletes stale chunks on reindex', async () => {
    const [source] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'github_repo',
        identifier: 'mnemis/reindex-fixture',
        displayName: 'reindex fixture',
        config: {
          localPath: repoRoot,
          includePaths: ['src'],
          chunkMaxChars: 1_000,
        },
        status: 'pending',
      })
      .returning();

    await db.insert(chunks).values({
      workspaceId,
      sourceId: source!.id,
      path: 'deleted.md',
      lineStart: 1,
      lineEnd: 1,
      rawText: 'old stale content',
      metadata: { index_run_id: 'previous-run' },
    });
    await db.insert(jobs).values({
      workspaceId,
      kind: 'reindex_source',
      payload: { source_id: source!.id },
      scheduledAt: CLAIM_FIRST,
    });

    await processOneJob(db);

    const indexedChunks = await db.select().from(chunks).where(eq(chunks.sourceId, source!.id));
    assert.ok(indexedChunks.length >= 1);
    assert.ok(indexedChunks.every((chunk) => chunk.path !== 'deleted.md'));
    assert.ok(indexedChunks.every((chunk) => chunk.path.startsWith('src/')));
  });

  it('indexes docs_site URLs through the crawler pipeline', async () => {
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith('/robots.txt') || href.endsWith('/sitemap.xml')) {
        return new Response('', { status: 404 });
      }
      if (href === 'https://docs.worker.test/') {
        return htmlResponse(
          html(
            'Docs Home',
            '<h1>Docs Home</h1><h2>Search</h2><p>Hybrid retrieval over crawled docs.</p><a href="/advanced">Advanced</a>',
          ),
        );
      }
      if (href === 'https://docs.worker.test/advanced') {
        return htmlResponse(
          html('Advanced', '<h1>Advanced</h1><p>Contextual prefixes improve retrieval.</p>'),
        );
      }
      return new Response('', { status: 404 });
    };

    const [source] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'docs_site',
        identifier: 'https://docs.worker.test',
        displayName: 'crawler docs',
        config: { maxPages: 2, contextualPrefixMode: 'never' },
        status: 'pending',
      })
      .returning();

    const [job] = await db
      .insert(jobs)
      .values({
        workspaceId,
        kind: 'index_source',
        payload: { source_id: source!.id },
        scheduledAt: CLAIM_FIRST,
      })
      .returning();

    const processed = await processOneJob(db);
    assert.equal(processed, true);

    const [updatedJob] = await db.select().from(jobs).where(eq(jobs.id, job!.id)).limit(1);
    const [updatedSource] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, source!.id))
      .limit(1);
    assert.equal(updatedSource!.status, 'indexed');
    assert.ok(updatedSource!.lastIndexedAt);
    assert.ok(updatedSource!.lastChangeAt);
    assert.equal(updatedJob!.status, 'completed');
    assert.equal((updatedJob!.result as { files: number }).files, 2);
    assert.equal(
      (updatedJob!.result as { contextual_prefix_skipped_reason: string })
        .contextual_prefix_skipped_reason,
      'contextualPrefixMode is never',
    );

    const indexedChunks = await db.select().from(chunks).where(eq(chunks.sourceId, source!.id));
    assert.ok(indexedChunks.some((chunk) => chunk.path === 'index.md'));
    assert.ok(indexedChunks.some((chunk) => chunk.path === 'advanced.md'));
    assert.ok(indexedChunks.every((chunk) => chunk.language === 'markdown'));

    const fts = await db
      .select({ id: chunks.id })
      .from(chunks)
      .where(sql`${chunks.bodyTsv} @@ websearch_to_tsquery('english', ${'crawled docs'})`);
    assert.ok(fts.length >= 1);
  });

  it('marks robots-blocked docs jobs as failed without crashing the worker', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
      return new Response('', { status: 500 });
    };

    const [source] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'docs_site',
        identifier: 'https://blocked.worker.test',
        displayName: 'blocked docs',
        config: {},
        status: 'pending',
      })
      .returning();

    const [job] = await db
      .insert(jobs)
      .values({
        workspaceId,
        kind: 'index_source',
        payload: { source_id: source!.id },
        scheduledAt: CLAIM_FIRST,
      })
      .returning();

    const processed = await processOneJob(db);
    assert.equal(processed, true);

    const [updatedSource] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, source!.id))
      .limit(1);
    const [updatedJob] = await db.select().from(jobs).where(eq(jobs.id, job!.id)).limit(1);

    assert.equal(updatedSource!.status, 'failed');
    assert.match(updatedSource!.statusMessage ?? '', /robots\.txt disallows/);
    assert.equal(updatedJob!.status, 'failed');
    assert.match(updatedJob!.error ?? '', /robots\.txt disallows/);
  });

  it('embeds chunks when VOYAGE_API_KEY is configured', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    resetEmbeddingsForTests();
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[]; model: string };
      return new Response(
        JSON.stringify({
          data: body.input.map((_text, index) => ({
            index,
            embedding: unitVector(body.model === 'voyage-code-3' ? 2 : 3),
          })),
          usage: { total_tokens: body.input.length },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const [source] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'github_repo',
        identifier: 'mnemis/embedded-fixture',
        displayName: 'embedded fixture',
        config: {
          localPath: repoRoot,
          includePaths: ['src', 'README.md'],
          chunkMaxChars: 1_000,
        },
        status: 'pending',
      })
      .returning();
    const [job] = await db
      .insert(jobs)
      .values({
        workspaceId,
        kind: 'index_source',
        payload: { source_id: source!.id },
        scheduledAt: CLAIM_FIRST,
      })
      .returning();

    await processOneJob(db);

    const [updatedJob] = await db.select().from(jobs).where(eq(jobs.id, job!.id)).limit(1);
    assert.equal(updatedJob!.status, 'completed');
    assert.equal((updatedJob!.result as { chunks_embedded: number }).chunks_embedded, 2);
    assert.deepEqual(
      (updatedJob!.result as { embedding_model_counts: Record<string, number> })
        .embedding_model_counts,
      { 'voyage-code-3': 1, 'voyage-3.5-large': 1 },
    );

    const indexedChunks = await db.select().from(chunks).where(eq(chunks.sourceId, source!.id));
    assert.equal(indexedChunks.length, 2);
    assert.ok(indexedChunks.every((chunk) => chunk.embedding));
    assert.ok(
      indexedChunks.every(
        (chunk) =>
          (chunk.metadata as { embedding_model?: string }).embedding_model === 'voyage-code-3' ||
          (chunk.metadata as { embedding_model?: string }).embedding_model === 'voyage-3.5-large',
      ),
    );

    unsetVoyageKey();
    resetEmbeddingsForTests();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('generates contextual prefixes for docs chunks when Anthropic is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.ANTHROPIC_CONTEXT_MODEL = 'claude-test-context';
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        system: { text: string; cache_control?: { type: string } }[];
        messages: { content: { text: string }[] }[];
      };
      assert.equal(body.model, 'claude-test-context');
      assert.equal(body.system[1]?.cache_control?.type, 'ephemeral');
      assert.match(body.system[1]?.text ?? '', /Mnemis Fixture/);
      assert.match(body.messages[0]?.content[0]?.text ?? '', /Hybrid search combines/);

      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: 'This README chunk introduces source overview retrieval concepts for Mnemis.',
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 50,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const [source] = await db
      .insert(sources)
      .values({
        workspaceId,
        kind: 'docs_site',
        identifier: 'https://docs.contextual.test',
        displayName: 'contextual docs',
        config: {
          localPath: repoRoot,
          includePaths: ['README.md'],
          contextualPrefixMode: 'auto',
        },
        status: 'pending',
      })
      .returning();
    const [job] = await db
      .insert(jobs)
      .values({
        workspaceId,
        kind: 'index_source',
        payload: { source_id: source!.id },
        scheduledAt: CLAIM_FIRST,
      })
      .returning();

    await processOneJob(db);

    const [updatedJob] = await db.select().from(jobs).where(eq(jobs.id, job!.id)).limit(1);
    assert.equal(updatedJob!.status, 'completed');
    assert.equal(
      (updatedJob!.result as { chunks_contextualized: number }).chunks_contextualized,
      1,
    );
    assert.equal(
      (updatedJob!.result as { contextual_prefix_model: string }).contextual_prefix_model,
      'claude-test-context',
    );
    assert.equal(
      (updatedJob!.result as { contextual_prefix_cache_creation_input_tokens: number })
        .contextual_prefix_cache_creation_input_tokens,
      100,
    );
    assert.equal(
      (updatedJob!.result as { contextual_prefix_cache_read_input_tokens: number })
        .contextual_prefix_cache_read_input_tokens,
      50,
    );

    const indexedChunks = await db.select().from(chunks).where(eq(chunks.sourceId, source!.id));
    assert.equal(indexedChunks.length, 1);
    assert.equal(
      indexedChunks[0]!.contextualPrefix,
      'This README chunk introduces source overview retrieval concepts for Mnemis.',
    );
    assert.equal(
      (indexedChunks[0]!.metadata as { contextual_prefix_model?: string }).contextual_prefix_model,
      'claude-test-context',
    );
    assert.ok(
      (indexedChunks[0]!.metadata as { contextual_prefix_document_hash?: string })
        .contextual_prefix_document_hash,
    );
    assert.equal(calls, 1);

    const fts = await db
      .select({ id: chunks.id })
      .from(chunks)
      .where(sql`${chunks.bodyTsv} @@ websearch_to_tsquery('english', ${'source overview'})`);
    assert.ok(fts.some((row) => row.id === indexedChunks[0]!.id));

    unsetAnthropicKey();
    Reflect.deleteProperty(process.env, 'ANTHROPIC_CONTEXT_MODEL');
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('marks malformed index jobs as failed instead of leaving them processing', async () => {
    const [job] = await db
      .insert(jobs)
      .values({
        workspaceId,
        kind: 'index_source',
        payload: {},
        scheduledAt: CLAIM_FIRST,
      })
      .returning();

    const processed = await processOneJob(db);
    assert.equal(processed, true);

    const [updatedJob] = await db.select().from(jobs).where(eq(jobs.id, job!.id)).limit(1);
    assert.equal(updatedJob!.status, 'failed');
    assert.match(updatedJob!.error ?? '', /missing source_id/);
    assert.ok(updatedJob!.completedAt);
  });
});
