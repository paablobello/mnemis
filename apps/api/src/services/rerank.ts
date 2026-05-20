import {
  type LocalRerankerClient,
  type VoyageRerankModel,
  getLocalReranker,
  getVoyageReranker,
} from '@mnemis/embeddings';

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

type RerankProvider = 'none' | 'voyage' | 'local';

function rerankerProvider(): RerankProvider {
  const provider = process.env.MNEMIS_RERANK_PROVIDER?.trim().toLowerCase();
  if (provider === 'voyage') return 'voyage';
  if (provider === 'local') return 'local';
  return 'none';
}

function localRerankerModel(): string | undefined {
  return process.env.MNEMIS_LOCAL_RERANK_MODEL?.trim() || undefined;
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

interface RerankClient {
  rerank(
    query: string,
    documents: string[],
    opts: { topK: number },
  ): Promise<{
    results: Array<{ index: number; relevanceScore: number }>;
    model: string;
    totalTokens: number;
  }>;
}

function buildRerankClient(provider: RerankProvider): RerankClient | null {
  if (provider === 'voyage') {
    const model = rerankerModel();
    const client = getVoyageReranker({ defaultModel: model });
    if (!client) return null;
    return {
      rerank: (query, documents, opts) =>
        client.rerank(query, documents, { model, topK: opts.topK }),
    };
  }
  if (provider === 'local') {
    const localClient: LocalRerankerClient = getLocalReranker({ modelId: localRerankerModel() });
    return {
      rerank: (query, documents, opts) => localClient.rerank(query, documents, { topK: opts.topK }),
    };
  }
  return null;
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

  const client = buildRerankClient(rerankerProvider());
  if (!client) {
    return {
      hits: hits.slice(0, limit),
      stats: { reranked: false, reranker_model: null, reranker_tokens: 0 },
    };
  }

  const documents = hits.map((hit) => documentForRerank(toDocument(hit)));
  let result: Awaited<ReturnType<RerankClient['rerank']>>;
  try {
    result = await client.rerank(query, documents, { topK: Math.min(limit, hits.length) });
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
