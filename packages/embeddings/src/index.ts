import { createHash } from 'node:crypto';

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
  model: VoyageModel;
  totalTokens: number;
  cacheHits: number;
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

  constructor(apiKey: string, defaultModel: VoyageModel = 'voyage-3.5-large') {
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

let singleton: EmbeddingsClient | null = null;
let singletonKey: string | null = null;
let singletonDefaultModel: VoyageModel = 'voyage-3.5-large';

export function getEmbeddings(
  opts: { apiKey?: string; defaultModel?: VoyageModel } = {},
): EmbeddingsClient | null {
  const key = opts.apiKey ?? process.env.VOYAGE_API_KEY?.trim();
  const defaultModel = opts.defaultModel ?? 'voyage-3.5-large';

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
  singletonDefaultModel = 'voyage-3.5-large';
}
