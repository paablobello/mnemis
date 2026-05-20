import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  apiKeyHash,
  apiKeyHashCandidates,
  apiKeyPrefix,
  isLegacyApiKeyHash,
  legacyApiKeyHash,
} from '../src/api-keys.ts';

describe('api key hashing', () => {
  it('legacyApiKeyHash produces a deterministic 64-char sha256 hex string', () => {
    const h = legacyApiKeyHash('mn_test_abc');
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, legacyApiKeyHash('mn_test_abc'));
    assert.notEqual(h, legacyApiKeyHash('mn_test_different'));
  });

  it('apiKeyHash with a secret returns an hmac_sha256: prefixed hex', () => {
    const h = apiKeyHash('mn_test_abc', 'super-secret');
    assert.ok(h.startsWith('hmac_sha256:'));
    const hex = h.slice('hmac_sha256:'.length);
    assert.equal(hex.length, 64);
    assert.match(hex, /^[0-9a-f]{64}$/);
  });

  it('apiKeyHash falls back to legacy when the secret is missing or empty', () => {
    const expected = legacyApiKeyHash('mn_test_abc');
    assert.equal(apiKeyHash('mn_test_abc', undefined), expected);
    assert.equal(apiKeyHash('mn_test_abc', ''), expected);
    assert.equal(apiKeyHash('mn_test_abc', '   '), expected);
  });

  it('apiKeyHash is sensitive to the secret', () => {
    const a = apiKeyHash('mn_test_abc', 'secret-one');
    const b = apiKeyHash('mn_test_abc', 'secret-two');
    assert.notEqual(a, b);
  });

  it('apiKeyHashCandidates returns both HMAC and legacy hashes when a secret is set', () => {
    const candidates = apiKeyHashCandidates('mn_test_abc', 'super-secret');
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0], apiKeyHash('mn_test_abc', 'super-secret'));
    assert.equal(candidates[1], legacyApiKeyHash('mn_test_abc'));
  });

  it('apiKeyHashCandidates returns a single legacy hash when there is no secret', () => {
    assert.deepEqual(apiKeyHashCandidates('mn_test_abc', undefined), [
      legacyApiKeyHash('mn_test_abc'),
    ]);
    assert.deepEqual(apiKeyHashCandidates('mn_test_abc', ''), [legacyApiKeyHash('mn_test_abc')]);
  });

  it('isLegacyApiKeyHash distinguishes between the two formats', () => {
    assert.equal(isLegacyApiKeyHash(legacyApiKeyHash('mn_test_abc')), true);
    assert.equal(isLegacyApiKeyHash(apiKeyHash('mn_test_abc', 'secret')), false);
  });

  it('apiKeyPrefix returns the first 11 chars (or the full string when shorter)', () => {
    assert.equal(apiKeyPrefix('mn_test_1234567890abcdef'), 'mn_test_123');
    assert.equal(apiKeyPrefix('short'), 'short');
    assert.equal(apiKeyPrefix(''), '');
  });
});
