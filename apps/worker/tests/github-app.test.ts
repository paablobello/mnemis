import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { exportPKCS8, generateKeyPair, importPKCS8, jwtVerify } from 'jose';
import {
  GitHubAppNotConfiguredError,
  GitHubAppTokenError,
  createInstallationTokenStore,
  fetchInstallationToken,
  signAppJwt,
} from '../src/github-app.ts';

const APP_ID = '424242';
const INSTALLATION_ID = '99999';

let privateKey = '';
let publicKey: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'];

before(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

function tokenResponse(token: string, expiresInSeconds: number, now = Date.now()): Response {
  return new Response(
    JSON.stringify({
      token,
      expires_at: new Date(now + expiresInSeconds * 1000).toISOString(),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('signAppJwt', () => {
  it('produces a JWT with RS256, correct iss and ~10min validity', async () => {
    const beforeMs = Date.now();
    const jwt = await signAppJwt({ appId: APP_ID, privateKey });
    const verified = await jwtVerify(jwt, publicKey, { algorithms: ['RS256'] });
    assert.equal(verified.payload.iss, APP_ID);
    const iat = verified.payload.iat as number;
    const exp = verified.payload.exp as number;
    const beforeS = Math.floor(beforeMs / 1000);
    assert.ok(iat <= beforeS - 60 && iat >= beforeS - 65, `iat ${iat} out of window`);
    assert.equal(exp - iat, 540);
    assert.equal(verified.protectedHeader.alg, 'RS256');
  });

  it('roundtrips through importPKCS8 (PEM is valid)', async () => {
    const key = await importPKCS8(privateKey, 'RS256');
    assert.ok(key);
  });
});

describe('fetchInstallationToken', () => {
  it('parses token and expiresAt on 200', async () => {
    const expiresInMs = 60 * 60 * 1000;
    const now = Date.now();
    const fakeFetch: typeof fetch = async () => tokenResponse('ghs_secret', 3600, now);
    const result = await fetchInstallationToken(INSTALLATION_ID, 'jwt', { fetch: fakeFetch });
    assert.equal(result.token, 'ghs_secret');
    assert.ok(Math.abs(result.expiresAt.getTime() - (now + expiresInMs)) < 2000);
  });

  it('maps 401 to jwt_invalid', async () => {
    const fakeFetch: typeof fetch = async () => new Response('Bad credentials', { status: 401 });
    await assert.rejects(
      fetchInstallationToken(INSTALLATION_ID, 'jwt', { fetch: fakeFetch }),
      (err) => err instanceof GitHubAppTokenError && err.code === 'jwt_invalid',
    );
  });

  it('maps 403 to installation_suspended', async () => {
    const fakeFetch: typeof fetch = async () => new Response('Suspended', { status: 403 });
    await assert.rejects(
      fetchInstallationToken(INSTALLATION_ID, 'jwt', { fetch: fakeFetch }),
      (err) => err instanceof GitHubAppTokenError && err.code === 'installation_suspended',
    );
  });

  it('maps 404 to installation_not_found', async () => {
    const fakeFetch: typeof fetch = async () => new Response('Not Found', { status: 404 });
    await assert.rejects(
      fetchInstallationToken(INSTALLATION_ID, 'jwt', { fetch: fakeFetch }),
      (err) => err instanceof GitHubAppTokenError && err.code === 'installation_not_found',
    );
  });

  it('targets the install access_tokens endpoint with Bearer auth', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    const fakeFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      const headers = new Headers(init?.headers ?? undefined);
      capturedAuth = headers.get('authorization') ?? '';
      return tokenResponse('ghs_x', 3600);
    };
    await fetchInstallationToken('inst-1', 'JWT123', { fetch: fakeFetch });
    assert.equal(capturedUrl, 'https://api.github.com/app/installations/inst-1/access_tokens');
    assert.equal(capturedAuth, 'Bearer JWT123');
  });
});

describe('createInstallationTokenStore', () => {
  it('throws GitHubAppNotConfiguredError when appId or key is missing', async () => {
    const store = createInstallationTokenStore({ appId: null, privateKey: null });
    await assert.rejects(
      store.getInstallationToken(INSTALLATION_ID),
      (err) => err instanceof GitHubAppNotConfiguredError,
    );

    const onlyId = createInstallationTokenStore({ appId: APP_ID, privateKey: null });
    await assert.rejects(
      onlyId.getInstallationToken(INSTALLATION_ID),
      (err) => err instanceof GitHubAppNotConfiguredError,
    );
  });

  it('caches a fresh token across calls', async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      return tokenResponse(`ghs_${calls}`, 3600);
    };
    const store = createInstallationTokenStore({ appId: APP_ID, privateKey }, { fetch: fakeFetch });
    const a = await store.getInstallationToken(INSTALLATION_ID);
    const b = await store.getInstallationToken(INSTALLATION_ID);
    assert.equal(calls, 1);
    assert.equal(a, b);
    assert.equal(a, 'ghs_1');
  });

  it('refreshes the token when within the expiry buffer', async () => {
    let calls = 0;
    let now = 1_700_000_000_000;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      // Each token expires 30s from "now" → inside the 60s refresh buffer.
      return tokenResponse(`ghs_${calls}`, 30, now);
    };
    const store = createInstallationTokenStore(
      { appId: APP_ID, privateKey },
      { fetch: fakeFetch, now: () => now },
    );
    const first = await store.getInstallationToken(INSTALLATION_ID);
    now += 100; // tiny advance, still inside buffer because TTL is 30s
    const second = await store.getInstallationToken(INSTALLATION_ID);
    assert.equal(calls, 2);
    assert.equal(first, 'ghs_1');
    assert.equal(second, 'ghs_2');
  });

  it('isolates cache per installation id', async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async (url) => {
      calls += 1;
      const u = String(url);
      const id = u.split('/installations/')[1]?.split('/')[0] ?? '';
      return tokenResponse(`ghs_${id}_${calls}`, 3600);
    };
    const store = createInstallationTokenStore({ appId: APP_ID, privateKey }, { fetch: fakeFetch });
    const a = await store.getInstallationToken('inst-a');
    const b = await store.getInstallationToken('inst-b');
    assert.notEqual(a, b);
    assert.equal(calls, 2);

    await store.getInstallationToken('inst-a');
    await store.getInstallationToken('inst-b');
    assert.equal(calls, 2);

    store.invalidate('inst-a');
    await store.getInstallationToken('inst-a');
    assert.equal(calls, 3);

    store.invalidate();
    await store.getInstallationToken('inst-b');
    assert.equal(calls, 4);
  });
});
