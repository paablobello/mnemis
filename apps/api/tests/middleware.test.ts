import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Hono } from 'hono';
// Side-effect import keeps the ContextVariableMap augmentation in scope.
import '../src/middleware/auth.ts';
import { bodySizeLimit } from '../src/middleware/body-limit.ts';
import { rateLimit, resetRateLimitForTests } from '../src/middleware/rate-limit.ts';

const ORIGINAL_MODE = process.env.MNEMIS_MODE;
const ORIGINAL_RATE = process.env.MNEMIS_RATE_LIMIT_PER_MINUTE;
const ORIGINAL_BODY = process.env.MNEMIS_MAX_BODY_BYTES;

afterEach(() => {
  resetRateLimitForTests();
  if (ORIGINAL_MODE === undefined) Reflect.deleteProperty(process.env, 'MNEMIS_MODE');
  else process.env.MNEMIS_MODE = ORIGINAL_MODE;
  if (ORIGINAL_RATE === undefined)
    Reflect.deleteProperty(process.env, 'MNEMIS_RATE_LIMIT_PER_MINUTE');
  else process.env.MNEMIS_RATE_LIMIT_PER_MINUTE = ORIGINAL_RATE;
  if (ORIGINAL_BODY === undefined) Reflect.deleteProperty(process.env, 'MNEMIS_MAX_BODY_BYTES');
  else process.env.MNEMIS_MAX_BODY_BYTES = ORIGINAL_BODY;
});

function makeRateLimitedApp(): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth', { workspaceId: 'ws-1', apiKeyId: 'key-1', scopes: ['*'] });
    await next();
  });
  app.use('*', rateLimit);
  app.get('/ping', (c) => c.json({ ok: true }));
  return app;
}

function makeBodyLimitedApp(): Hono {
  const app = new Hono();
  app.use('*', bodySizeLimit);
  app.post('/echo', async (c) => {
    const body = await c.req.text();
    return c.json({ length: body.length });
  });
  return app;
}

describe('rateLimit middleware', () => {
  it('returns 200 with ratelimit-* headers under the limit', async () => {
    process.env.MNEMIS_RATE_LIMIT_PER_MINUTE = '5';
    const app = makeRateLimitedApp();
    const res = await app.request('/ping', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('ratelimit-limit'), '5');
    assert.equal(res.headers.get('ratelimit-remaining'), '4');
    assert.ok(res.headers.get('ratelimit-reset'));
  });

  it('returns 429 with retry-after when the bucket exceeds the limit', async () => {
    process.env.MNEMIS_RATE_LIMIT_PER_MINUTE = '2';
    const app = makeRateLimitedApp();
    const headers = { 'x-forwarded-for': '1.2.3.4' };
    assert.equal((await app.request('/ping', { headers })).status, 200);
    assert.equal((await app.request('/ping', { headers })).status, 200);

    const blocked = await app.request('/ping', { headers });
    assert.equal(blocked.status, 429);
    const json = (await blocked.json()) as {
      error: string;
      retry_after_seconds: number;
    };
    assert.equal(json.error, 'rate_limited');
    assert.ok(json.retry_after_seconds > 0);
    assert.ok(blocked.headers.get('retry-after'));
  });

  it('keeps independent buckets for different client IPs', async () => {
    process.env.MNEMIS_RATE_LIMIT_PER_MINUTE = '1';
    const app = makeRateLimitedApp();
    const a = await app.request('/ping', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    const b = await app.request('/ping', { headers: { 'x-forwarded-for': '2.2.2.2' } });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const aOver = await app.request('/ping', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    assert.equal(aOver.status, 429);
  });

  it('defaults to 120 req/min in cloud mode and 600 in self-host', async () => {
    Reflect.deleteProperty(process.env, 'MNEMIS_RATE_LIMIT_PER_MINUTE');
    const app = makeRateLimitedApp();

    process.env.MNEMIS_MODE = 'cloud';
    const cloud = await app.request('/ping', { headers: { 'x-forwarded-for': '9.9.9.9' } });
    assert.equal(cloud.headers.get('ratelimit-limit'), '120');

    resetRateLimitForTests();
    process.env.MNEMIS_MODE = 'self-host';
    const local = await app.request('/ping', { headers: { 'x-forwarded-for': '9.9.9.9' } });
    assert.equal(local.headers.get('ratelimit-limit'), '600');
  });
});

describe('bodySizeLimit middleware', () => {
  it('passes requests within the default 1MB limit', async () => {
    const app = makeBodyLimitedApp();
    const body = 'x'.repeat(100);
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'content-length': String(body.length) },
      body,
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { length: number };
    assert.equal(json.length, body.length);
  });

  it('returns 413 payload_too_large when content-length exceeds the override', async () => {
    process.env.MNEMIS_MAX_BODY_BYTES = '10';
    const app = makeBodyLimitedApp();
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'content-length': '11' },
      body: 'a'.repeat(11),
    });
    assert.equal(res.status, 413);
    const json = (await res.json()) as { error: string; max_body_bytes: number };
    assert.equal(json.error, 'payload_too_large');
    assert.equal(json.max_body_bytes, 10);
  });

  it('lets requests through when content-length header is missing', async () => {
    process.env.MNEMIS_MAX_BODY_BYTES = '5';
    const app = makeBodyLimitedApp();
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'this body is far longer than five bytes',
    });
    // Without an explicit content-length we trust the route handler to enforce
    // its own bounds; the middleware only short-circuits when the header lies.
    assert.equal(res.status, 200);
  });
});
