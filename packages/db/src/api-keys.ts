import { createHash, createHmac } from 'node:crypto';

const HMAC_PREFIX = 'hmac_sha256:';

export function legacyApiKeyHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function apiKeyHash(raw: string, secret: string | undefined): string {
  const normalizedSecret = secret?.trim();
  if (!normalizedSecret) return legacyApiKeyHash(raw);
  return `${HMAC_PREFIX}${createHmac('sha256', normalizedSecret).update(raw).digest('hex')}`;
}

export function apiKeyHashCandidates(raw: string, secret: string | undefined): string[] {
  const primary = apiKeyHash(raw, secret);
  const legacy = legacyApiKeyHash(raw);
  return primary === legacy ? [legacy] : [primary, legacy];
}

export function isLegacyApiKeyHash(hash: string): boolean {
  return !hash.startsWith(HMAC_PREFIX);
}

export function apiKeyPrefix(raw: string): string {
  return raw.slice(0, 11);
}
