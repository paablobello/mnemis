/**
 * Local cross-encoder reranker (BGE family) running on @huggingface/transformers
 * (ONNX runtime). Designed as a drop-in alternative to the Voyage reranker for
 * self-hosted deployments without internet egress.
 *
 * The first call downloads the model to `env.cacheDir`; subsequent calls reuse
 * the in-memory pipeline. Latency is ~50-150ms for 20 docs on CPU (M-series).
 */
import type { PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers';

export type LocalRerankModel = 'Xenova/bge-reranker-v2-m3' | string;

export interface LocalRerankResult {
  results: Array<{ index: number; relevanceScore: number }>;
  model: LocalRerankModel;
  /** Approximate input token count (sum across pairs); 0 if we cannot infer. */
  totalTokens: number;
}

export class LocalRerankerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LocalRerankerError';
    this.code = code;
  }
}

interface LoadedPipeline {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

let pipelineCache: { modelId: string; loader: Promise<LoadedPipeline> } | null = null;

async function loadPipeline(modelId: string, cacheDir: string | null): Promise<LoadedPipeline> {
  // Dynamic import keeps the heavy WASM/ONNX runtime out of the startup path
  // when nobody calls the local reranker.
  const transformers = await import('@huggingface/transformers');
  if (cacheDir) {
    transformers.env.cacheDir = cacheDir;
  }
  const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelId);
  const model = await transformers.AutoModelForSequenceClassification.from_pretrained(modelId, {
    // Defaults to fp32; quantized files exist for bge-reranker-v2-m3.
    dtype: 'q8',
  });
  return { tokenizer, model };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function approxTokens(input: { input_ids?: { dims?: number[] } }): number {
  const dims = input.input_ids?.dims;
  if (!dims || dims.length < 2) return 0;
  const batch = dims[0] ?? 0;
  const seq = dims[1] ?? 0;
  return batch * seq;
}

export interface LocalRerankerOptions {
  modelId?: LocalRerankModel;
  /** Override env.cacheDir for the underlying model store. */
  cacheDir?: string;
}

export class LocalRerankerClient {
  readonly modelId: LocalRerankModel;
  private readonly cacheDir: string | null;

  constructor(options: LocalRerankerOptions = {}) {
    this.modelId = options.modelId ?? 'Xenova/bge-reranker-v2-m3';
    this.cacheDir = options.cacheDir ?? null;
  }

  async rerank(
    query: string,
    documents: string[],
    opts: { topK?: number } = {},
  ): Promise<LocalRerankResult> {
    if (documents.length === 0) {
      return { results: [], model: this.modelId, totalTokens: 0 };
    }

    const { tokenizer, model } = await this.ensurePipeline();

    const queries = documents.map(() => query);
    const inputs = await (
      tokenizer as unknown as (
        text: string[],
        config: { text_pair: string[]; padding: boolean; truncation: boolean },
      ) => Promise<{ input_ids?: { dims?: number[] } } & Record<string, unknown>>
    )(queries, {
      text_pair: documents,
      padding: true,
      truncation: true,
    });

    const output = (await (
      model as unknown as (i: unknown) => Promise<{ logits: { data: Float32Array | number[] } }>
    )(inputs)) as { logits: { data: Float32Array | number[] } };

    const logits = Array.from(output.logits.data) as number[];
    const scored: Array<{ index: number; relevanceScore: number }> = logits.map((logit, index) => ({
      index,
      relevanceScore: sigmoid(logit),
    }));
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    const topK = opts.topK ?? scored.length;
    return {
      results: scored.slice(0, topK),
      model: this.modelId,
      totalTokens: approxTokens(inputs as { input_ids?: { dims?: number[] } }),
    };
  }

  private async ensurePipeline(): Promise<LoadedPipeline> {
    if (!pipelineCache || pipelineCache.modelId !== this.modelId) {
      pipelineCache = {
        modelId: this.modelId,
        loader: loadPipeline(this.modelId, this.cacheDir).catch((err) => {
          pipelineCache = null;
          throw new LocalRerankerError(
            'local_reranker_load_failed',
            `Could not load local reranker ${this.modelId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
      };
    }
    return pipelineCache.loader;
  }
}

let singleton: LocalRerankerClient | null = null;
let singletonModelId: string | null = null;

export function getLocalReranker(options: LocalRerankerOptions = {}): LocalRerankerClient {
  const modelId = options.modelId ?? 'Xenova/bge-reranker-v2-m3';
  if (!singleton || singletonModelId !== modelId) {
    singleton = new LocalRerankerClient(options);
    singletonModelId = modelId;
  }
  return singleton;
}

export function resetLocalRerankerForTests(): void {
  singleton = null;
  singletonModelId = null;
  pipelineCache = null;
}
