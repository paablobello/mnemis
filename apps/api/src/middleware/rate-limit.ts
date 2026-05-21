import { usageEvents } from '@mnemis/db';
import { type SQL, and, eq, gte, lt, sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getDb } from '../db.ts';
import type { AuthContext } from './auth.ts';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

type RateLimitBackend = 'memory' | 'postgres';

interface RateLimitDecision {
  count: number;
  resetAt: number;
}

function defaultLimit(): number {
  return process.env.MNEMIS_MODE === 'cloud' ? 120 : 600;
}

function requestsPerMinute(): number {
  const configured = Number.parseInt(process.env.MNEMIS_RATE_LIMIT_PER_MINUTE ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultLimit();
}

function envBoolean(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function rateLimitBackend(): RateLimitBackend {
  const configured = process.env.MNEMIS_RATE_LIMIT_BACKEND;
  if (configured === 'memory' || configured === 'postgres') return configured;
  return process.env.MNEMIS_MODE === 'cloud' ? 'postgres' : 'memory';
}

function windowResetAt(now: number): number {
  return Math.floor(now / WINDOW_MS) * WINDOW_MS + WINDOW_MS;
}

function clientIp(headers: Headers): string {
  if (!envBoolean('MNEMIS_TRUST_PROXY')) return 'direct';
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}

function consumeMemoryBucket(auth: AuthContext, ip: string, now: number): RateLimitDecision {
  const key = `${auth.workspaceId}:${auth.apiKeyId}:${ip}`;
  const resetAt = windowResetAt(now);
  const bucket = buckets.get(key);
  const current = bucket && bucket.resetAt > now ? bucket : { count: 0, resetAt };
  current.count += 1;
  buckets.set(key, current);

  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  return { count: current.count, resetAt: current.resetAt };
}

async function consumePostgresBucket(input: {
  auth: AuthContext;
  ip: string;
  now: number;
  limit: number;
  method: string;
  path: string;
}): Promise<RateLimitDecision> {
  const db = getDb();
  const resetAt = windowResetAt(input.now);
  const windowStart = resetAt - WINDOW_MS;
  const windowStartDate = new Date(windowStart);
  const resetAtDate = new Date(resetAt);
  const rateKey = `${input.auth.apiKeyId}:${input.ip}`;
  const lockKey = `${input.auth.workspaceId}:${rateKey}:${windowStart}`;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.workspaceId, input.auth.workspaceId),
          eq(usageEvents.apiKeyId, input.auth.apiKeyId),
          eq(usageEvents.kind, 'request'),
          gte(usageEvents.occurredAt, windowStartDate),
          lt(usageEvents.occurredAt, resetAtDate),
          sql`${usageEvents.metadata}->>'rate_key' = ${rateKey}`,
        ) as SQL<unknown>,
      );

    const count = row?.count ?? 0;
    const nextCount = count + 1;
    if (nextCount <= input.limit) {
      await tx.insert(usageEvents).values({
        workspaceId: input.auth.workspaceId,
        apiKeyId: input.auth.apiKeyId,
        kind: 'request',
        costCredits: 0,
        occurredAt: new Date(input.now),
        metadata: {
          rate_key: rateKey,
          client_ip: input.ip,
          method: input.method,
          path: input.path,
        },
      });
    }

    return { count: nextCount, resetAt };
  });
}

export const rateLimit: MiddlewareHandler = async (c, next) => {
  const limit = requestsPerMinute();
  const now = Date.now();
  const auth = c.get('auth');
  const ip = clientIp(c.req.raw.headers);
  const decision =
    rateLimitBackend() === 'postgres'
      ? await consumePostgresBucket({
          auth,
          ip,
          now,
          limit,
          method: c.req.method,
          path: c.req.path,
        })
      : consumeMemoryBucket(auth, ip, now);

  const remaining = Math.max(0, limit - decision.count);
  c.header('ratelimit-limit', String(limit));
  c.header('ratelimit-remaining', String(remaining));
  c.header('ratelimit-reset', String(Math.ceil(decision.resetAt / 1000)));

  if (decision.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((decision.resetAt - now) / 1000));
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

  await next();
};
