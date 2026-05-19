import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  EmbeddingsClient,
  EmbeddingsProviderError,
  getEmbeddings,
  resetEmbeddingsForTests,
} from '../src/index.ts';

const originalFetch = globalThis.fetch;
const originalKey = process.env.VOYAGE_API_KEY;

function unsetVoyageKey(): void {
  Reflect.deleteProperty(process.env, 'VOYAGE_API_KEY');
}

function vector(value: number): number[] {
  return Array.from({ length: 1024 }, (_, i) => (i === 0 ? value : 0));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) {
    unsetVoyageKey();
  } else {
    process.env.VOYAGE_API_KEY = originalKey;
  }
  resetEmbeddingsForTests();
});

describe('EmbeddingsClient', () => {
  it('batches requests and caches repeated inputs', async () => {
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(
        JSON.stringify({
          data: body.input.map((_text, index) => ({ index, embedding: vector(index + 1) })),
          usage: { total_tokens: body.input.length },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const client = new EmbeddingsClient('test');
    const first = await client.embedBatch(['alpha', 'beta'], { inputType: 'document' });
    const second = await client.embedBatch(['alpha', 'beta'], { inputType: 'document' });

    assert.equal(calls, 1);
    assert.equal(first.cacheHits, 0);
    assert.equal(second.cacheHits, 2);
    assert.deepEqual(second.vectors[0], vector(1));
  });

  it('returns null when the env key is absent and recreates when it appears', () => {
    unsetVoyageKey();
    assert.equal(getEmbeddings(), null);

    process.env.VOYAGE_API_KEY = 'test-key';
    assert.ok(getEmbeddings());
  });

  it('throws a typed provider error on failed responses', async () => {
    globalThis.fetch = async () => new Response('nope', { status: 503 });
    const client = new EmbeddingsClient('test');

    await assert.rejects(
      () => client.embed('alpha', { inputType: 'query' }),
      (err) => err instanceof EmbeddingsProviderError && err.code === 'embeddings_provider_error',
    );
  });
});
