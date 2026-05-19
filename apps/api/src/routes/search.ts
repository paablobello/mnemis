import { Hono } from 'hono';
import { ApiError } from '../errors.ts';
import { requireScopes } from '../middleware/auth.ts';
import {
  type SearchCitation,
  buildCitations,
  renderSearchMarkdown,
} from '../services/search-render.ts';
import {
  SynthesisUnavailableError,
  defaultSynthesisOptions,
  synthesizeAnswer,
} from '../services/search-synthesis.ts';
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

  const citations: SearchCitation[] = buildCitations(result.hits);
  const items = result.hits.map((hit, index) => ({
    ...chunkToDto(hit, {
      includeContent: include.has('content'),
      includeMetadata: include.has('metadata'),
    }),
    citation_number: citations[index]!.n,
    permalink: citations[index]!.permalink,
  }));

  const base = {
    query: input.query,
    retrieval: result.retrieval,
    used_vector: result.used_vector,
    embedding_model: result.embedding_model,
    embedding_tokens: result.embedding_tokens,
    items,
    citations,
    count: result.hits.length,
  };

  if (input.mode === 'raw') {
    return c.json({ ...base, mode: 'raw' });
  }

  if (input.mode === 'markdown') {
    const markdown = renderSearchMarkdown(input.query, result.hits, citations);
    return c.json({ ...base, mode: 'markdown', markdown });
  }

  try {
    const synthesis = await synthesizeAnswer(input.query, result.hits, citations, {
      model: input.synthesisModel,
      ...defaultSynthesisOptions(),
    });
    return c.json({
      ...base,
      mode: 'synthesized',
      answer: synthesis.answer,
      synthesis_model: synthesis.model,
      synthesis_usage: synthesis.usage,
    });
  } catch (err) {
    if (err instanceof SynthesisUnavailableError) {
      throw ApiError.failedDependency('synthesis_unavailable', err.message);
    }
    throw err;
  }
});
