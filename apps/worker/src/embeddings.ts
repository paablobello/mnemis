import { createHash } from 'node:crypto';
import { type VoyageModel, getEmbeddings } from '@mnemis/embeddings';
import type { IndexChunk } from '@mnemis/indexer';

const MAX_EMBED_TEXT_CHARS = 24_000;
const CODE_LANGUAGES = new Set([
  'c',
  'cpp',
  'csharp',
  'go',
  'java',
  'javascript',
  'javascriptreact',
  'python',
  'rust',
  'typescript',
  'typescriptreact',
]);

export interface EmbeddedIndexChunk extends IndexChunk {
  embedding: number[] | null;
  embeddingModel: VoyageModel | null;
  embeddingTextHash: string | null;
}

export interface ChunkEmbeddingStats {
  enabled: boolean;
  embedded: number;
  totalTokens: number;
  cacheHits: number;
  modelCounts: Partial<Record<VoyageModel, number>>;
  skippedReason: string | null;
}

function modelForChunk(chunk: IndexChunk): VoyageModel {
  return chunk.language && CODE_LANGUAGES.has(chunk.language)
    ? 'voyage-code-3'
    : 'voyage-3.5-large';
}

function embedTextForChunk(chunk: IndexChunk): string {
  const section = chunk.sectionPath.length > 0 ? `Section: ${chunk.sectionPath.join(' > ')}` : null;
  const text = [chunk.contextualPrefix, `Path: ${chunk.path}`, section, chunk.rawText]
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return text.slice(0, MAX_EMBED_TEXT_CHARS);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function embedChunksForIndexing(
  chunks: IndexChunk[],
): Promise<{ chunks: EmbeddedIndexChunk[]; stats: ChunkEmbeddingStats }> {
  const client = getEmbeddings();
  if (!client) {
    return {
      chunks: chunks.map((chunk) => ({
        ...chunk,
        embedding: null,
        embeddingModel: null,
        embeddingTextHash: null,
      })),
      stats: {
        enabled: false,
        embedded: 0,
        totalTokens: 0,
        cacheHits: 0,
        modelCounts: {},
        skippedReason: 'VOYAGE_API_KEY is not configured',
      },
    };
  }

  const out = new Array<EmbeddedIndexChunk>(chunks.length);
  const groups = new Map<VoyageModel, { index: number; text: string }[]>();

  chunks.forEach((chunk, index) => {
    if (chunk.metadata.retrieval_role === 'parent') {
      out[index] = {
        ...chunk,
        embedding: null,
        embeddingModel: null,
        embeddingTextHash: null,
      };
      return;
    }
    const model = modelForChunk(chunk);
    const text = embedTextForChunk(chunk);
    const list = groups.get(model) ?? [];
    list.push({ index, text });
    groups.set(model, list);
  });

  let totalTokens = 0;
  let cacheHits = 0;
  const modelCounts: Partial<Record<VoyageModel, number>> = {};

  for (const [model, items] of groups) {
    const result = await client.embedBatch(
      items.map((item) => item.text),
      { inputType: 'document', model },
    );
    totalTokens += result.totalTokens;
    cacheHits += result.cacheHits;
    modelCounts[model] = items.length;

    result.vectors.forEach((embedding, offset) => {
      const item = items[offset]!;
      const chunk = chunks[item.index]!;
      out[item.index] = {
        ...chunk,
        embedding,
        embeddingModel: model,
        embeddingTextHash: hashText(item.text),
      };
    });
  }

  return {
    chunks: out,
    stats: {
      enabled: true,
      embedded: out.filter((chunk) => chunk.embedding !== null).length,
      totalTokens,
      cacheHits,
      modelCounts,
      skippedReason: null,
    },
  };
}
