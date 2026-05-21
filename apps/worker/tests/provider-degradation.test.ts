import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { resetEmbeddingsForTests } from '@mnemis/embeddings';
import type { IndexChunk, LoadedFile } from '@mnemis/indexer';
import { applyContextualPrefixes } from '../src/contextual-prefix.ts';
import { embedChunksForIndexing } from '../src/embeddings.ts';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function unsetVoyageKey(): void {
  Reflect.deleteProperty(process.env, 'VOYAGE_API_KEY');
}

function unsetAnthropicKey(): void {
  Reflect.deleteProperty(process.env, 'ANTHROPIC_API_KEY');
}

function chunk(overrides: Partial<IndexChunk> = {}): IndexChunk {
  return {
    path: 'README.md',
    lineStart: 1,
    lineEnd: 4,
    rawText: 'Contextual retrieval improves search quality for documentation chunks.',
    contextualPrefix: null,
    language: 'markdown',
    sectionPath: ['Overview'],
    metadata: {},
    ...overrides,
  };
}

function file(overrides: Partial<LoadedFile> = {}): LoadedFile {
  const content = '# Overview\n\nContextual retrieval improves search quality.';
  return {
    path: 'README.md',
    absolutePath: '/tmp/README.md',
    content,
    language: 'markdown',
    byteLength: Buffer.byteLength(content),
    modifiedAt: new Date('2026-05-20T00:00:00.000Z'),
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_VOYAGE_API_KEY === undefined) unsetVoyageKey();
  else process.env.VOYAGE_API_KEY = ORIGINAL_VOYAGE_API_KEY;
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) unsetAnthropicKey();
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
  resetEmbeddingsForTests();
});

describe('provider degradation', () => {
  it('keeps chunks indexable when Voyage embeddings fail', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    resetEmbeddingsForTests();
    globalThis.fetch = async () => new Response('provider down', { status: 503 });

    const result = await embedChunksForIndexing([chunk()]);

    assert.equal(result.stats.enabled, true);
    assert.equal(result.stats.embedded, 0);
    assert.match(result.stats.skippedReason ?? '', /Voyage API 503/);
    assert.equal(result.chunks[0]!.embedding, null);
    assert.equal(result.chunks[0]!.embeddingModel, null);
    assert.equal(result.chunks[0]!.embeddingTextHash, null);
  });

  it('keeps chunks indexable when Anthropic contextual prefixes fail', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    globalThis.fetch = async () => new Response('provider down', { status: 503 });

    const result = await applyContextualPrefixes({
      sourceKind: 'docs_site',
      files: [file()],
      chunks: [chunk()],
      config: { contextualPrefixMode: 'auto' },
    });

    assert.equal(result.stats.enabled, true);
    assert.equal(result.stats.eligible, 1);
    assert.equal(result.stats.generated, 0);
    assert.equal(result.stats.skipped, 1);
    assert.match(result.stats.skippedReason ?? '', /Anthropic contextual prefix error 503/);
    assert.equal(result.chunks[0]!.contextualPrefix, null);
  });
});
