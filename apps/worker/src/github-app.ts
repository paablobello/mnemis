import { SignJWT, importPKCS8 } from 'jose';

const GITHUB_API_BASE = 'https://api.github.com';
const JWT_TTL_SECONDS = 540;
const JWT_BACKDATE_SECONDS = 60;
const TOKEN_REFRESH_BUFFER_MS = 60_000;

export type GitHubAppTokenErrorCode =
  | 'jwt_invalid'
  | 'installation_suspended'
  | 'installation_not_found'
  | 'unknown';

export class GitHubAppNotConfiguredError extends Error {
  constructor(
    message = 'GitHub App is not configured: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY to clone private repos',
  ) {
    super(message);
    this.name = 'GitHubAppNotConfiguredError';
  }
}

export class GitHubAppTokenError extends Error {
  status: number;
  code: GitHubAppTokenErrorCode;

  constructor(status: number, code: GitHubAppTokenErrorCode, message: string) {
    super(message);
    this.name = 'GitHubAppTokenError';
    this.status = status;
    this.code = code;
  }
}

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
}

export interface InstallationTokenStore {
  getInstallationToken(installationId: string): Promise<string>;
  invalidate(installationId?: string): void;
}

interface CachedToken {
  token: string;
  expiresAt: Date;
}

interface StoreOptions {
  now?: () => number;
  fetch?: typeof fetch;
  baseUrl?: string;
}

export async function signAppJwt(config: GitHubAppConfig, nowMs = Date.now()): Promise<string> {
  const key = await importPKCS8(config.privateKey, 'RS256');
  const iat = Math.floor(nowMs / 1000) - JWT_BACKDATE_SECONDS;
  const exp = iat + JWT_TTL_SECONDS;
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setIssuer(config.appId)
    .sign(key);
}

function statusToCode(status: number): GitHubAppTokenErrorCode {
  if (status === 401) return 'jwt_invalid';
  if (status === 403) return 'installation_suspended';
  if (status === 404) return 'installation_not_found';
  return 'unknown';
}

export async function fetchInstallationToken(
  installationId: string,
  appJwt: string,
  options: { fetch?: typeof fetch; baseUrl?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const baseUrl = options.baseUrl ?? GITHUB_API_BASE;
  const url = `${baseUrl}/app/installations/${encodeURIComponent(installationId)}/access_tokens`;
  const fetcher = options.fetch ?? fetch;
  const response = await fetcher(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mnemis-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // ignore
    }
    throw new GitHubAppTokenError(
      response.status,
      statusToCode(response.status),
      `GitHub installation token request failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };
  return { token: data.token, expiresAt: new Date(data.expires_at) };
}

export function createInstallationTokenStore(
  config: { appId?: string | null; privateKey?: string | null },
  options: StoreOptions = {},
): InstallationTokenStore {
  const cache = new Map<string, CachedToken>();
  const now = options.now ?? (() => Date.now());

  return {
    async getInstallationToken(installationId) {
      if (!config.appId || !config.privateKey) {
        throw new GitHubAppNotConfiguredError();
      }
      const cached = cache.get(installationId);
      if (cached && cached.expiresAt.getTime() - now() > TOKEN_REFRESH_BUFFER_MS) {
        return cached.token;
      }
      const jwt = await signAppJwt({ appId: config.appId, privateKey: config.privateKey }, now());
      const fresh = await fetchInstallationToken(installationId, jwt, {
        fetch: options.fetch,
        baseUrl: options.baseUrl,
      });
      cache.set(installationId, fresh);
      return fresh.token;
    },
    invalidate(installationId) {
      if (installationId === undefined) {
        cache.clear();
        return;
      }
      cache.delete(installationId);
    },
  };
}
