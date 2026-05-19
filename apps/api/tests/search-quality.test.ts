/**
 * Small custom retrieval benchmark for the memory API.
 *
 * This is not a replacement for BEIR / LoCoMo / LongMemEval. It is the first
 * local quality gate: if a future retrieval change cannot rank obvious Mnemis
 * facts above distractors, it should fail before we build source indexing on it.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { apiKeys, createDatabase, users, workspaces } from '@mnemis/db';
import { type RetrievalCase, evaluateRetrieval } from '@mnemis/eval';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required for integration tests');

if (!process.env.INTERNAL_AUTH_SECRET) process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const db = createDatabase({ url });
const app = createApp({ silent: true });

const TEST_SLUG = `quality-${randomBytes(4).toString('hex')}`;
const TEST_EMAIL = `${TEST_SLUG}@mnemis.test`;
const RAW_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const KEY_HASH = createHash('sha256').update(RAW_KEY).digest('hex');

let workspaceId = '';
let userId = '';

const headers = () => ({
  'content-type': 'application/json',
  authorization: `Bearer ${RAW_KEY}`,
});

const benchmarkMemories = [
  {
    id: 'pgvector_hnsw',
    title: 'pgvector HNSW search',
    summary: 'Vector search uses cosine distance in Postgres pgvector.',
    body: 'Mnemis stores 1024 dimension embeddings in Postgres with pgvector and queries them through an HNSW index using cosine distance.',
    tags: ['quality', 'retrieval'],
  },
  {
    id: 'rrf_fusion',
    title: 'Reciprocal Rank Fusion',
    summary: 'RRF combines lexical and vector rankings.',
    body: 'Hybrid search retrieves top candidates from BM25 and vector search, then combines their ranks with Reciprocal Rank Fusion using k equals 60.',
    tags: ['quality', 'retrieval'],
  },
  {
    id: 'mxbai_reranker',
    title: 'mxbai reranker',
    summary: 'The chosen reranker is mxbai-rerank-large-v2.',
    body: 'After RRF fusion, Mnemis should rerank the top 50 candidates with mxbai-rerank-large-v2 and return the top 10 results.',
    tags: ['quality', 'reranker'],
  },
  {
    id: 'ttl_sweep',
    title: 'TTL sweep',
    summary: 'Working and session memories expire automatically.',
    body: 'Working memories default to a one hour TTL and session memories default to seven days. The admin sweep archives expired memories.',
    tags: ['quality', 'memory'],
  },
  {
    id: 'api_key_scopes',
    title: 'API key scopes',
    summary: 'Machine auth is based on hashed API keys and scopes.',
    body: 'API keys are stored as sha256 hashes. Routes require scopes such as memories read, memories write, search read, and admin sweep.',
    tags: ['quality', 'auth'],
  },
  {
    id: 'contextual_retrieval',
    title: 'Anthropic Contextual Retrieval',
    summary: 'Contextual prefixes improve docs retrieval.',
    body: 'Documentation chunks get a short contextual prefix generated from the whole document before embedding and BM25 indexing.',
    tags: ['quality', 'chunking'],
  },
  {
    id: 'tree_sitter_chunking',
    title: 'tree-sitter AST chunking',
    summary: 'Code chunks follow syntax boundaries.',
    body: 'Repository indexing uses tree-sitter to split TypeScript, Python, Go, Rust, and Java code into functions, classes, and parent-child chunks.',
    tags: ['quality', 'chunking'],
  },
  {
    id: 'firecrawl_docs',
    title: 'Firecrawl docs crawler',
    summary: 'Docs sites are crawled into clean Markdown.',
    body: 'Mnemis uses Firecrawl for documentation sites, respecting robots and llms text, then converts HTML pages into clean Markdown chunks.',
    tags: ['quality', 'docs'],
  },
  {
    id: 'distractor_cooking',
    title: 'Slow cooked beans',
    summary: 'A recipe note unrelated to retrieval systems.',
    body: 'Soak beans overnight, add garlic and bay leaf, then simmer slowly until tender.',
    tags: ['quality', 'distractor'],
  },
  {
    id: 'distractor_travel',
    title: 'Madrid train plan',
    summary: 'Travel logistics unrelated to memory search.',
    body: 'Take the morning train, check the platform, and keep the reservation code available.',
    tags: ['quality', 'distractor'],
  },
] as const;

const benchmarkCases: RetrievalCase[] = [
  {
    id: 'q_rrf',
    query: 'combine BM25 and vector rankings with reciprocal rank fusion',
    relevant: { rrf_fusion: 3, pgvector_hnsw: 1 },
  },
  {
    id: 'q_ttl',
    query: 'how working memories expire and get archived',
    relevant: { ttl_sweep: 3 },
  },
  {
    id: 'q_reranker',
    query: 'which reranker runs after RRF fusion top 50',
    relevant: { mxbai_reranker: 3, rrf_fusion: 1 },
  },
  {
    id: 'q_code_chunking',
    query: 'split code into functions classes parent child chunks using syntax tree',
    relevant: { tree_sitter_chunking: 3, contextual_retrieval: 1 },
  },
  {
    id: 'q_docs_crawler',
    query: 'provider for crawling documentation sites into markdown',
    relevant: { firecrawl_docs: 3, contextual_retrieval: 1 },
  },
];

const logicalToMemoryId = new Map<string, string>();
const memoryIdToLogical = new Map<string, string>();

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
    name: 'quality',
    keyHash: KEY_HASH,
    prefix: RAW_KEY.slice(0, 11),
    scopes: ['memories:*', 'search:*'],
  });

  for (const memory of benchmarkMemories) {
    const res = await app.request('/v1/memories', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'fact',
        title: memory.title,
        summary: memory.summary,
        body: memory.body,
        tags: memory.tags,
      }),
    });
    assert.equal(res.status, 201);
    const json = await res.json();
    logicalToMemoryId.set(memory.id, json.data.id);
    memoryIdToLogical.set(json.data.id, memory.id);
  }
});

after(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('memory search quality', () => {
  it('meets the custom Mnemis keyword retrieval gate', async () => {
    const result = await evaluateRetrieval(benchmarkCases, async (testCase) => {
      const res = await app.request('/v1/memories/search', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ query: testCase.query, tags: ['quality'], limit: 10 }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      return json.items.map((item: { memory: { id: string } }) => ({
        id: memoryIdToLogical.get(item.memory.id) ?? item.memory.id,
      }));
    });

    assert.equal(logicalToMemoryId.size, benchmarkMemories.length);
    assert.ok(
      result.summary.ndcgAt10 >= 0.85,
      `nDCG@10 below gate: ${JSON.stringify(result, null, 2)}`,
    );
    assert.ok(
      result.summary.mrrAt10 >= 0.8,
      `MRR@10 below gate: ${JSON.stringify(result, null, 2)}`,
    );
    assert.ok(
      result.summary.recallAt5 >= 0.8,
      `Recall@5 below gate: ${JSON.stringify(result, null, 2)}`,
    );
  });
});
