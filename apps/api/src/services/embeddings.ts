import {
  type EmbeddingsClient,
  EmbeddingsProviderError,
  type VoyageInputType,
  type VoyageModel,
  getEmbeddings as getSharedEmbeddings,
} from '@mnemis/embeddings';
import { ApiError } from '../errors.ts';

export { EmbeddingsProviderError };
export type { EmbeddingsClient };

export interface OptionalEmbeddingResult {
  vector: number[] | null;
  model: VoyageModel | null;
  tokens: number;
  skippedReason: string | null;
}

export function getEmbeddings(): EmbeddingsClient | null {
  return getSharedEmbeddings();
}

function providerFailureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, ' ').trim().slice(0, 240) || 'unknown provider error';
}

export async function tryEmbedText(
  text: string,
  opts: { inputType: VoyageInputType; model?: VoyageModel; context: string },
): Promise<OptionalEmbeddingResult> {
  const client = getEmbeddings();
  if (!client) {
    return {
      vector: null,
      model: null,
      tokens: 0,
      skippedReason: 'VOYAGE_API_KEY is not configured',
    };
  }

  try {
    const result = await client.embed(text, { inputType: opts.inputType, model: opts.model });
    return {
      vector: result.vector,
      model: result.model,
      tokens: result.tokens,
      skippedReason: null,
    };
  } catch (err) {
    const reason = providerFailureReason(err);
    console.warn(`${opts.context} embedding skipped`, { reason });
    return {
      vector: null,
      model: null,
      tokens: 0,
      skippedReason: reason,
    };
  }
}

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
