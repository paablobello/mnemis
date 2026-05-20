import { createHash } from 'node:crypto';
import { resetLocalRerankerForTests } from './local-reranker.ts';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_RERANK_URL = 'https://api.voyageai.com/v1/rerank';
const MAX_BATCH = 128;
const CACHE_LIMIT = 2_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

export type VoyageModel = 'voyage-3-large' | 'voyage-code-3';
export type VoyageRerankModel = 'rerank-2.5' | 'rerank-2.5-lite' | 'rerank-2' | 'rerank-2-lite';
export type VoyageInputType = 'document' | 'query';

export interface EmbedOptions {
  model?: VoyageModel;
  inputType: VoyageInputType;
}

export interface EmbedResult {
  vectors: number[][];
  model: VoyageModel;
  totalTokens: number;
  cacheHits: number;
}

export interface RerankResult {
  results: Array<{ index: number; relevanceScore: number }>;
  model: VoyageRerankModel;
  totalTokens: number;
}

export class EmbeddingsProviderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 424) {
    super(message);
    this.name = 'EmbeddingsProviderError';
    this.code = code;
    this.status = status;
  }
}

export class EmbeddingsClient {
  readonly defaultModel: VoyageModel;
  private readonly apiKey: string;
  private readonly cache = new Map<string, number[]>();

  constructor(apiKey: string, defaultModel: VoyageModel = 'voyage-3-large') {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async embed(
    text: string,
    opts: EmbedOptions,
  ): Promise<{ vector: number[]; model: VoyageModel; tokens: number }> {
    const result = await this.embedBatch([text], opts);
    return {
      vector: result.vectors[0]!,
      model: result.model,
      tokens: result.totalTokens,
    };
  }

  async embedBatch(texts: string[], opts: EmbedOptions): Promise<EmbedResult> {
    const model = opts.model ?? this.defaultModel;
    const vectors = new Array<number[] | undefined>(texts.length);
    const missingIdx: number[] = [];
    const missingTexts: string[] = [];
    let cacheHits = 0;

    texts.forEach((text, i) => {
      const key = this.cacheKey(model, opts.inputType, text);
      const hit = this.cache.get(key);
      if (hit) {
        vectors[i] = hit;
        cacheHits++;
      } else {
        missingIdx.push(i);
        missingTexts.push(text);
      }
    });

    let totalTokens = 0;
    for (let start = 0; start < missingTexts.length; start += MAX_BATCH) {
      const slice = missingTexts.slice(start, start + MAX_BATCH);
      const { embeddings, tokens } = await this.callVoyage(slice, opts.inputType, model);
      totalTokens += tokens;
      embeddings.forEach((vec, j) => {
        const originalIdx = missingIdx[start + j]!;
        vectors[originalIdx] = vec;
        this.cachePut(this.cacheKey(model, opts.inputType, slice[j]!), vec);
      });
    }

    return {
      vectors: vectors as number[][],
      model,
      totalTokens,
      cacheHits,
    };
  }

  private async callVoyage(
    inputs: string[],
    inputType: VoyageInputType,
    model: VoyageModel,
  ): Promise<{ embeddings: number[][]; tokens: number }> {
    const res = await fetchWithTimeout(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: inputs,
        input_type: inputType,
        output_dimension: 1024,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new EmbeddingsProviderError(
        'embeddings_provider_error',
        `Voyage API ${res.status}: ${text.slice(0, 500)}`,
      );
    }

    const json = (await res.json()) as {
      data?: { embedding: number[]; index: number }[];
      usage?: { total_tokens?: number };
    };

    if (!Array.isArray(json.data) || json.data.length !== inputs.length) {
      throw new EmbeddingsProviderError(
        'embeddings_provider_malformed_response',
        'Voyage API returned an invalid embeddings payload',
      );
    }

    const ordered = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { embeddings: ordered, tokens: json.usage?.total_tokens ?? 0 };
  }

  private cacheKey(model: string, inputType: string, text: string): string {
    return createHash('sha256').update(`${model}|${inputType}|${text}`).digest('hex');
  }

  private cachePut(key: string, vec: number[]) {
    if (this.cache.size >= CACHE_LIMIT) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, vec);
  }
}

function providerTimeoutMs(): number {
  const configured = Number.parseInt(process.env.MNEMIS_PROVIDER_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PROVIDER_TIMEOUT_MS;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('provider_timeout')),
    providerTimeoutMs(),
  );
  try {
    return await fetch(url, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class VoyageRerankerClient {
  readonly defaultModel: VoyageRerankModel;
  private readonly apiKey: string;

  constructor(apiKey: string, defaultModel: VoyageRerankModel = 'rerank-2.5') {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async rerank(
    query: string,
    documents: string[],
    opts: { model?: VoyageRerankModel; topK?: number } = {},
  ): Promise<RerankResult> {
    const model = opts.model ?? this.defaultModel;
    const res = await fetchWithTimeout(VOYAGE_RERANK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        documents,
        model,
        top_k: opts.topK,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new EmbeddingsProviderError(
        'rerank_provider_error',
        `Voyage rerank API ${res.status}: ${text.slice(0, 500)}`,
      );
    }

    const json = (await res.json()) as {
      data?: Array<{ index: number; relevance_score?: number; relevanceScore?: number }>;
      usage?: { total_tokens?: number };
    };

    if (!Array.isArray(json.data)) {
      throw new EmbeddingsProviderError(
        'rerank_provider_malformed_response',
        'Voyage rerank API returned an invalid payload',
      );
    }

    return {
      results: json.data.map((item) => ({
        index: item.index,
        relevanceScore: item.relevance_score ?? item.relevanceScore ?? 0,
      })),
      model,
      totalTokens: json.usage?.total_tokens ?? 0,
    };
  }
}

let singleton: EmbeddingsClient | null = null;
let singletonKey: string | null = null;
let singletonDefaultModel: VoyageModel = 'voyage-3-large';
let rerankerSingleton: VoyageRerankerClient | null = null;
let rerankerKey: string | null = null;
let rerankerDefaultModel: VoyageRerankModel = 'rerank-2.5';

export function getEmbeddings(
  opts: { apiKey?: string; defaultModel?: VoyageModel } = {},
): EmbeddingsClient | null {
  const key = opts.apiKey ?? process.env.VOYAGE_API_KEY?.trim();
  const defaultModel = opts.defaultModel ?? 'voyage-3-large';

  if (!key) {
    singleton = null;
    singletonKey = null;
    singletonDefaultModel = defaultModel;
    return null;
  }

  if (!singleton || singletonKey !== key || singletonDefaultModel !== defaultModel) {
    singleton = new EmbeddingsClient(key, defaultModel);
    singletonKey = key;
    singletonDefaultModel = defaultModel;
  }

  return singleton;
}

export function resetEmbeddingsForTests(): void {
  singleton = null;
  singletonKey = null;
  singletonDefaultModel = 'voyage-3-large';
  rerankerSingleton = null;
  rerankerKey = null;
  rerankerDefaultModel = 'rerank-2.5';
  resetLocalRerankerForTests();
}

export {
  LocalRerankerClient,
  LocalRerankerError,
  getLocalReranker,
  type LocalRerankerOptions,
  type LocalRerankModel,
  type LocalRerankResult,
} from './local-reranker.ts';
export { resetLocalRerankerForTests };

export function getVoyageReranker(
  opts: { apiKey?: string; defaultModel?: VoyageRerankModel } = {},
): VoyageRerankerClient | null {
  const key = opts.apiKey ?? process.env.VOYAGE_API_KEY?.trim();
  const defaultModel = opts.defaultModel ?? 'rerank-2.5';

  if (!key) {
    rerankerSingleton = null;
    rerankerKey = null;
    rerankerDefaultModel = defaultModel;
    return null;
  }

  if (!rerankerSingleton || rerankerKey !== key || rerankerDefaultModel !== defaultModel) {
    rerankerSingleton = new VoyageRerankerClient(key, defaultModel);
    rerankerKey = key;
    rerankerDefaultModel = defaultModel;
  }

  return rerankerSingleton;
}
