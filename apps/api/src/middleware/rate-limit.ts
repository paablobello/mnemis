import type { MiddlewareHandler } from 'hono';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

function defaultLimit(): number {
  return process.env.MNEMIS_MODE === 'cloud' ? 120 : 600;
}

function requestsPerMinute(): number {
  const configured = Number.parseInt(process.env.MNEMIS_RATE_LIMIT_PER_MINUTE ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultLimit();
}

function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}

export const rateLimit: MiddlewareHandler = async (c, next) => {
  const limit = requestsPerMinute();
  const now = Date.now();
  const auth = c.get('auth');
  const key = `${auth.workspaceId}:${auth.apiKeyId}:${clientIp(c.req.raw.headers)}`;
  const bucket = buckets.get(key);
  const current = bucket && bucket.resetAt > now ? bucket : { count: 0, resetAt: now + WINDOW_MS };
  current.count += 1;
  buckets.set(key, current);

  const remaining = Math.max(0, limit - current.count);
  c.header('ratelimit-limit', String(limit));
  c.header('ratelimit-remaining', String(remaining));
  c.header('ratelimit-reset', String(Math.ceil(current.resetAt / 1000)));

  if (current.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    c.header('retry-after', String(retryAfter));
    return c.json(
      {
        error: 'rate_limited',
        message: 'Rate limit exceeded',
        retry_after_seconds: retryAfter,
      },
      429,
    );
  }

  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  await next();
};
