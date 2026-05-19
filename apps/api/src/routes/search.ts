import { Hono } from 'hono';
import { ApiError } from '../errors.ts';
import { requireScopes } from '../middleware/auth.ts';
import { chunkToDto, searchSourceChunks } from '../services/source-search.ts';
import { sourceSearchSchema } from '../validators/sources.ts';

export const searchRoutes = new Hono();

searchRoutes.post('/', requireScopes('search:read'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = sourceSearchSchema.parse(body);
  const include = new Set(input.include ?? []);

  const result = await searchSourceChunks(
    auth.workspaceId,
    input.query,
    {
      sourceIds: input.sourceIds,
      kinds: input.kinds,
      pathPrefix: input.pathPrefix,
    },
    input.limit,
    { retrieval: input.retrieval },
  );

  return c.json({
    query: input.query,
    mode: 'raw',
    retrieval: result.retrieval,
    used_vector: result.used_vector,
    embedding_model: result.embedding_model,
    embedding_tokens: result.embedding_tokens,
    items: result.hits.map((hit) =>
      chunkToDto(hit, {
        includeContent: include.has('content'),
        includeMetadata: include.has('metadata'),
      }),
    ),
    count: result.hits.length,
  });
});
