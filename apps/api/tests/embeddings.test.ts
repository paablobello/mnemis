import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { resetEmbeddingsForTests } from '@mnemis/embeddings';
import { tryEmbedText } from '../src/services/embeddings.ts';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

function unsetVoyageKey(): void {
  Reflect.deleteProperty(process.env, 'VOYAGE_API_KEY');
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_VOYAGE_API_KEY === undefined) unsetVoyageKey();
  else process.env.VOYAGE_API_KEY = ORIGINAL_VOYAGE_API_KEY;
  resetEmbeddingsForTests();
});

describe('tryEmbedText', () => {
  it('returns null embedding when Voyage is not configured', async () => {
    unsetVoyageKey();
    resetEmbeddingsForTests();

    const result = await tryEmbedText('hello', { inputType: 'document', context: 'test' });

    assert.equal(result.vector, null);
    assert.equal(result.model, null);
    assert.equal(result.tokens, 0);
    assert.equal(result.skippedReason, 'VOYAGE_API_KEY is not configured');
  });

  it('returns null embedding when Voyage returns an error', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    resetEmbeddingsForTests();
    globalThis.fetch = async () => new Response('provider down', { status: 503 });

    const result = await tryEmbedText('hello', { inputType: 'document', context: 'test' });

    assert.equal(result.vector, null);
    assert.equal(result.model, null);
    assert.equal(result.tokens, 0);
    assert.match(result.skippedReason ?? '', /Voyage API 503/);
  });
});
