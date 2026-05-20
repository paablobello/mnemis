import { type VoyageRerankModel, getVoyageReranker } from '@mnemis/embeddings';

const MAX_RERANK_DOCUMENT_CHARS = 12_000;
const DEFAULT_RERANK_MODEL: VoyageRerankModel = 'rerank-2.5';

export interface RerankStats {
  reranked: boolean;
  reranker_model: string | null;
  reranker_tokens: number;
}

export interface Rerankable {
  rawText: string;
  contextualPrefix?: string | null;
  path?: string;
  sectionPath?: string[];
}

function rerankerProvider(): 'none' | 'voyage' {
  const provider = process.env.MNEMIS_RERANK_PROVIDER?.trim().toLowerCase();
  return provider === 'voyage' ? 'voyage' : 'none';
}

function rerankerModel(): VoyageRerankModel {
  const model = process.env.MNEMIS_RERANK_MODEL?.trim();
  if (
    model === 'rerank-2.5' ||
    model === 'rerank-2.5-lite' ||
    model === 'rerank-2' ||
    model === 'rerank-2-lite'
  ) {
    return model;
  }
  return DEFAULT_RERANK_MODEL;
}

function documentForRerank(item: Rerankable): string {
  const section =
    item.sectionPath && item.sectionPath.length > 0
      ? `Section: ${item.sectionPath.join(' > ')}`
      : null;
  return [item.contextualPrefix, item.path ? `Path: ${item.path}` : null, section, item.rawText]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_RERANK_DOCUMENT_CHARS);
}

export async function maybeRerank<T extends object>(
  query: string,
  hits: T[],
  limit: number,
  toDocument: (hit: T) => Rerankable,
): Promise<{ hits: T[]; stats: RerankStats }> {
  if (hits.length <= 1 || rerankerProvider() === 'none') {
    return {
      hits: hits.slice(0, limit),
      stats: { reranked: false, reranker_model: null, reranker_tokens: 0 },
    };
  }

  const model = rerankerModel();
  const client = getVoyageReranker({ defaultModel: model });
  if (!client) {
    return {
      hits: hits.slice(0, limit),
      stats: { reranked: false, reranker_model: null, reranker_tokens: 0 },
    };
  }

  const documents = hits.map((hit) => documentForRerank(toDocument(hit)));
  let result: Awaited<ReturnType<typeof client.rerank>>;
  try {
    result = await client.rerank(query, documents, { model, topK: Math.min(limit, hits.length) });
  } catch {
    return {
      hits: hits.slice(0, limit),
      stats: { reranked: false, reranker_model: null, reranker_tokens: 0 },
    };
  }
  const reranked = result.results
    .map((item) => ({ item, hit: hits[item.index] }))
    .filter(
      (entry): entry is { item: { index: number; relevanceScore: number }; hit: T } => !!entry.hit,
    )
    .map((entry) => ({
      ...entry.hit,
      score: entry.item.relevanceScore,
    })) as T[];

  return {
    hits: reranked.slice(0, limit),
    stats: {
      reranked: true,
      reranker_model: result.model,
      reranker_tokens: result.totalTokens,
    },
  };
}
