import {
  type EmbeddingsClient,
  EmbeddingsProviderError,
  getEmbeddings as getSharedEmbeddings,
} from '@mnemis/embeddings';
import { ApiError } from '../errors.ts';

export { EmbeddingsProviderError };
export type { EmbeddingsClient };

export function getEmbeddings(): EmbeddingsClient | null {
  return getSharedEmbeddings();
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
