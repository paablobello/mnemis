import { Hono } from 'hono';
import { ApiError } from '../errors.ts';
import { hasScope, requireScopes, scopeError } from '../middleware/auth.ts';
import { readJsonBody } from '../middleware/body-limit.ts';
import { assertCreditsAvailable } from '../services/quotas.ts';
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
import { recordUsage } from '../services/usage.ts';
import { sourceSearchSchema } from '../validators/sources.ts';

export const searchRoutes = new Hono();

searchRoutes.post('/', requireScopes('search:read'), async (c) => {
  const auth = c.get('auth');
  const body = await readJsonBody(c.req.raw);
  const input = sourceSearchSchema.parse(body);
  const include = new Set(input.include ?? []);
  const contentRequired =
    include.has('content') || input.mode === 'markdown' || input.mode === 'synthesized';
  if (contentRequired && !hasScope(auth.scopes, 'search:content')) {
    return c.json(scopeError(['search:content']), 403);
  }
  const estimatedCredits = input.mode === 'synthesized' ? 2 : 1;
  await assertCreditsAvailable(auth.workspaceId, estimatedCredits);

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
    reranked: result.reranked,
    reranker_model: result.reranker_model,
    reranker_tokens: result.reranker_tokens,
    items,
    citations,
    count: result.hits.length,
  };

  if (input.mode === 'raw') {
    await recordUsage(c, 'search', 1, {
      mode: input.mode,
      retrieval: result.retrieval,
      count: result.hits.length,
      embedding_tokens: result.embedding_tokens,
      reranker_tokens: result.reranker_tokens,
    });
    return c.json({ ...base, mode: 'raw' });
  }

  if (input.mode === 'markdown') {
    const markdown = renderSearchMarkdown(input.query, result.hits, citations);
    await recordUsage(c, 'search', 1, {
      mode: input.mode,
      retrieval: result.retrieval,
      count: result.hits.length,
      embedding_tokens: result.embedding_tokens,
      reranker_tokens: result.reranker_tokens,
    });
    return c.json({ ...base, mode: 'markdown', markdown });
  }

  try {
    const synthesis = await synthesizeAnswer(input.query, result.hits, citations, {
      model: input.synthesisModel,
      ...defaultSynthesisOptions(),
    });
    await recordUsage(c, 'synthesize', 2, {
      retrieval: result.retrieval,
      count: result.hits.length,
      embedding_tokens: result.embedding_tokens,
      reranker_tokens: result.reranker_tokens,
      synthesis_usage: synthesis.usage,
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
