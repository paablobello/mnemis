import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { LocalRerankerClient, getLocalReranker, resetLocalRerankerForTests } from '../src/index.ts';

afterEach(() => {
  resetLocalRerankerForTests();
});

describe('local reranker', () => {
  it('getLocalReranker returns a singleton scoped to modelId', () => {
    const a = getLocalReranker();
    const b = getLocalReranker();
    assert.equal(a, b);

    const other = getLocalReranker({ modelId: 'Xenova/some-other-reranker' });
    assert.notEqual(a, other);
  });

  it('exposes a typed client with the configured modelId', () => {
    const client = getLocalReranker({ modelId: 'Xenova/bge-reranker-base' });
    assert.ok(client instanceof LocalRerankerClient);
    assert.equal(client.modelId, 'Xenova/bge-reranker-base');
  });

  it('returns an empty result without loading the model when there are no documents', async () => {
    const client = getLocalReranker();
    const result = await client.rerank('any query', []);
    assert.deepEqual(result, {
      results: [],
      model: 'Xenova/bge-reranker-base',
      totalTokens: 0,
    });
  });

  // Opt-in: loads the actual ONNX model (~140MB download on first run).
  // Enable with MNEMIS_LOCAL_RERANKER_TESTS=1 when validating the cross-encoder.
  if (process.env.MNEMIS_LOCAL_RERANKER_TESTS === '1') {
    it('ranks relevant documents above unrelated ones (live model)', async () => {
      const client = getLocalReranker();
      const result = await client.rerank(
        'how does the reranker improve retrieval quality',
        [
          'Mnemis applies a cross-encoder reranker on top of hybrid retrieval to boost nDCG.',
          'Postgres pgvector stores embeddings for nearest-neighbour search.',
          'Bananas grow on trees and are yellow when ripe.',
        ],
        { topK: 3 },
      );
      assert.equal(result.results.length, 3);
      assert.equal(result.results[0]!.index, 0);
      assert.ok(result.results[0]!.relevanceScore > result.results[2]!.relevanceScore);
    });
  }
});
