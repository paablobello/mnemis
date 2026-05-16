/**
 * REST: /v1/memories
 *
 *   POST   /v1/memories                  create
 *   GET    /v1/memories                  list (filters)
 *   GET    /v1/memories/:id              retrieve
 *   PATCH  /v1/memories/:id              metadata-only update
 *   DELETE /v1/memories/:id              soft delete (?permanent=true for hard)
 *
 *   Search endpoints are mounted by `routes/search.ts` (Sprint 2.4).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../errors.ts';
import {
  createMemory,
  deleteMemory,
  getMemory,
  listMemories,
  patchMemory,
  toDto,
} from '../services/memories.ts';
import { type SearchHit, searchHybrid, searchKeyword } from '../services/search.ts';
import {
  createMemorySchema,
  listMemoriesQuerySchema,
  parseInclude,
  patchMemorySchema,
  searchBodySchema,
} from '../validators/memories.ts';

export const memoriesRoutes = new Hono();

const idParam = z.string().uuid();

function serializeHit(hit: SearchHit, include: Set<string>) {
  return {
    score: hit.score,
    ranks: hit.ranks,
    bm25_score: hit.bm25_score,
    vector_score: hit.vector_score,
    memory: toDto(hit.memory, {
      includeLineage: include.has('lineage'),
      includeEmbedding: include.has('embedding'),
    }),
  };
}

memoriesRoutes.post('/search', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = searchBodySchema.parse(body);
  const include = new Set(input.include ?? []);
  const hits = await searchKeyword(
    auth.workspaceId,
    input.query,
    { kind: input.kind, tags: input.tags, directory: input.directory },
    input.limit,
  );
  return c.json({
    query: input.query,
    mode: 'keyword',
    items: hits.map((h) => serializeHit(h, include)),
    count: hits.length,
  });
});

memoriesRoutes.post('/semantic-search', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = searchBodySchema.parse(body);
  const include = new Set(input.include ?? []);
  const result = await searchHybrid(
    auth.workspaceId,
    input.query,
    { kind: input.kind, tags: input.tags, directory: input.directory },
    input.limit,
  );
  return c.json({
    query: input.query,
    mode: result.used_vector ? 'hybrid_rrf' : 'keyword_only',
    embedding_model: result.embedding_model,
    embedding_tokens: result.embedding_tokens,
    items: result.hits.map((h) => serializeHit(h, include)),
    count: result.hits.length,
  });
});

memoriesRoutes.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = createMemorySchema.parse(body);
  const created = await createMemory(auth.workspaceId, input);
  return c.json({ data: toDto(created, { includeLineage: true }) }, 201);
});

memoriesRoutes.get('/', async (c) => {
  const auth = c.get('auth');
  const query = listMemoriesQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const include = parseInclude(query.include);

  const result = await listMemories(auth.workspaceId, {
    kind: query.kind,
    tag: query.tag,
    directory: query.directory,
    agentOrigin: query.agent_origin,
    q: query.q,
    includeArchived: query.include_archived,
    includeExpired: query.include_expired,
    limit: query.limit,
    offset: query.offset,
    createdAfter: query.created_after,
    createdBefore: query.created_before,
  });

  return c.json({
    items: result.items.map((m) =>
      toDto(m, {
        includeLineage: include.has('lineage'),
        includeEmbedding: include.has('embedding'),
      }),
    ),
    total: result.total,
    has_more: result.has_more,
    limit: query.limit,
    offset: query.offset,
  });
});

memoriesRoutes.get('/:id', async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const include = parseInclude(c.req.query('include'));
  const memory = await getMemory(auth.workspaceId, id);
  return c.json({
    data: toDto(memory, {
      includeLineage: include.has('lineage'),
      includeEmbedding: include.has('embedding'),
    }),
  });
});

memoriesRoutes.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = patchMemorySchema.parse(body);
  const updated = await patchMemory(auth.workspaceId, id, input);
  return c.json({ data: toDto(updated, { includeLineage: true }) });
});

memoriesRoutes.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const permanent = c.req.query('permanent') === 'true';
  await deleteMemory(auth.workspaceId, id, { permanent });
  return c.body(null, 204);
});
