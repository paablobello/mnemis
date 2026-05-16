/**
 * Voyage AI embeddings client.
 *
 * Models we use (per `tech-decisions.md`):
 *   - voyage-3.5-large : general (memories, docs)         — 1024 dims
 *   - voyage-code-3    : code chunks                       — 1024 dims
 *
 * input_type:
 *   - 'document' when indexing
 *   - 'query'    when searching
 *
 * Behaviour:
 *   - If `VOYAGE_API_KEY` is missing the client is `null` and callers MUST
 *     handle "embeddings disabled" explicitly. We never silently return
 *     fake vectors.
 *   - Per-process LRU-ish cache keyed on `sha256(model|input_type|text)` so
 *     the same content embedded twice (e.g. POST then immediate search) hits
 *     the cache.
 *   - Voyage allows up to 128 inputs per call. Batches larger than that are
 *     split client-side.
 */
import { createHash } from 'node:crypto';
import { ApiError } from '../errors.ts';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MAX_BATCH = 128;
const CACHE_LIMIT = 2_000;

export type VoyageModel = 'voyage-3.5-large' | 'voyage-code-3';
export type VoyageInputType = 'document' | 'query';

export interface EmbedOptions {
  model?: VoyageModel;
  inputType: VoyageInputType;
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  totalTokens: number;
  cacheHits: number;
}

export class EmbeddingsClient {
  readonly defaultModel: VoyageModel;
  private readonly apiKey: string;
  private readonly cache = new Map<string, number[]>();

  constructor(apiKey: string, defaultModel: VoyageModel = 'voyage-3.5-large') {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  /** Embed a single string. Convenience around `embedBatch`. */
  async embed(
    text: string,
    opts: EmbedOptions,
  ): Promise<{ vector: number[]; model: string; tokens: number }> {
    const result = await this.embedBatch([text], opts);
    return {
      vector: result.vectors[0]!,
      model: result.model,
      tokens: result.totalTokens,
    };
  }

  /** Embed up to N strings, with cache + auto-batching. */
  async embedBatch(texts: string[], opts: EmbedOptions): Promise<EmbedResult> {
    const model = opts.model ?? this.defaultModel;
    const vectors = new Array<number[] | undefined>(texts.length);
    const missingIdx: number[] = [];
    const missingTexts: string[] = [];
    let cacheHits = 0;

    texts.forEach((t, i) => {
      const key = this.cacheKey(model, opts.inputType, t);
      const hit = this.cache.get(key);
      if (hit) {
        vectors[i] = hit;
        cacheHits++;
      } else {
        missingIdx.push(i);
        missingTexts.push(t);
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
        const key = this.cacheKey(model, opts.inputType, slice[j]!);
        this.cachePut(key, vec);
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
    const res = await fetch(VOYAGE_URL, {
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
      throw ApiError.failedDependency(
        'embeddings_provider_error',
        `Voyage API ${res.status}: ${text.slice(0, 500)}`,
      );
    }

    const json = (await res.json()) as {
      data: { embedding: number[]; index: number }[];
      usage?: { total_tokens?: number };
    };

    const ordered = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { embeddings: ordered, tokens: json.usage?.total_tokens ?? 0 };
  }

  private cacheKey(model: string, inputType: string, text: string): string {
    return createHash('sha256').update(`${model}|${inputType}|${text}`).digest('hex');
  }

  private cachePut(key: string, vec: number[]) {
    if (this.cache.size >= CACHE_LIMIT) {
      // simple eviction: drop oldest insertion (Map preserves order)
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, vec);
  }
}

let singleton: EmbeddingsClient | null = null;
let initialised = false;

/**
 * Lazily build a singleton client. Returns `null` when VOYAGE_API_KEY is
 * missing — callers decide how to degrade (e.g. allow saves without
 * embedding, fail semantic search with 424).
 */
export function getEmbeddings(): EmbeddingsClient | null {
  if (initialised) return singleton;
  initialised = true;
  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) {
    singleton = null;
    return null;
  }
  singleton = new EmbeddingsClient(key);
  return singleton;
}

/** Throws 424 with a helpful message when embeddings are required but disabled. */
export function requireEmbeddings(): EmbeddingsClient {
  const e = getEmbeddings();
  if (!e) {
    throw ApiError.failedDependency(
      'embeddings_disabled',
      'VOYAGE_API_KEY is not configured. Semantic search requires embeddings.',
    );
  }
  return e;
}
