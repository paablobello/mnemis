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
import { hasScope, requireScopes, scopeError } from '../middleware/auth.ts';
import {
  createMemory,
  deleteMemory,
  getMemory,
  listMemories,
  patchMemory,
  toDto,
} from '../services/memories.ts';
import { type SearchHit, searchHybrid, searchKeyword } from '../services/search.ts';
import { recordUsage } from '../services/usage.ts';
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

memoriesRoutes.post('/search', requireScopes('search:read'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = searchBodySchema.parse(body);
  const include = new Set(input.include ?? []);
  if (include.has('embedding') && !hasScope(auth.scopes, 'memories:embedding')) {
    return c.json(scopeError(['memories:embedding']), 403);
  }
  const hits = await searchKeyword(
    auth.workspaceId,
    input.query,
    { kind: input.kind, tags: input.tags, directory: input.directory },
    input.limit,
  );
  await recordUsage(c, 'search', 1, { target: 'memories', mode: 'keyword', count: hits.length });
  return c.json({
    query: input.query,
    mode: 'keyword',
    items: hits.map((h) => serializeHit(h, include)),
    count: hits.length,
  });
});

memoriesRoutes.post('/semantic-search', requireScopes('search:read'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = searchBodySchema.parse(body);
  const include = new Set(input.include ?? []);
  if (include.has('embedding') && !hasScope(auth.scopes, 'memories:embedding')) {
    return c.json(scopeError(['memories:embedding']), 403);
  }
  const result = await searchHybrid(
    auth.workspaceId,
    input.query,
    { kind: input.kind, tags: input.tags, directory: input.directory },
    input.limit,
  );
  await recordUsage(c, 'search', 1, {
    target: 'memories',
    mode: result.used_vector ? 'hybrid_rrf' : 'keyword_only',
    count: result.hits.length,
    embedding_tokens: result.embedding_tokens,
    reranker_tokens: result.reranker_tokens,
  });
  return c.json({
    query: input.query,
    mode: result.used_vector ? 'hybrid_rrf' : 'keyword_only',
    embedding_model: result.embedding_model,
    embedding_tokens: result.embedding_tokens,
    reranked: result.reranked,
    reranker_model: result.reranker_model,
    reranker_tokens: result.reranker_tokens,
    items: result.hits.map((h) => serializeHit(h, include)),
    count: result.hits.length,
  });
});

memoriesRoutes.post('/', requireScopes('memories:write'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = createMemorySchema.parse(body);
  const created = await createMemory(auth.workspaceId, input);
  await recordUsage(c, 'save', 1, { memory_id: created.id, kind: created.kind });
  return c.json({ data: toDto(created, { includeLineage: true }) }, 201);
});

memoriesRoutes.get('/', requireScopes('memories:read'), async (c) => {
  const auth = c.get('auth');
  const query = listMemoriesQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const include = parseInclude(query.include);
  if (include.has('embedding') && !hasScope(auth.scopes, 'memories:embedding')) {
    return c.json(scopeError(['memories:embedding']), 403);
  }

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

memoriesRoutes.get('/:id', requireScopes('memories:read'), async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const include = parseInclude(c.req.query('include'));
  if (include.has('embedding') && !hasScope(auth.scopes, 'memories:embedding')) {
    return c.json(scopeError(['memories:embedding']), 403);
  }
  const memory = await getMemory(auth.workspaceId, id);
  return c.json({
    data: toDto(memory, {
      includeLineage: include.has('lineage'),
      includeEmbedding: include.has('embedding'),
    }),
  });
});

memoriesRoutes.patch('/:id', requireScopes('memories:write'), async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = patchMemorySchema.parse(body);
  const updated = await patchMemory(auth.workspaceId, id, input);
  return c.json({ data: toDto(updated, { includeLineage: true }) });
});

memoriesRoutes.delete('/:id', requireScopes('memories:delete'), async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const permanent = c.req.query('permanent') === 'true';
  if (permanent && !hasScope(auth.scopes, 'memories:delete:permanent')) {
    return c.json(scopeError(['memories:delete:permanent']), 403);
  }
  await deleteMemory(auth.workspaceId, id, { permanent });
  return c.body(null, 204);
});
