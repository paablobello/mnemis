import { createHash } from 'node:crypto';
import { apiKeys, workspaces } from '@mnemis/db';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getDb } from '../db.ts';

export interface AuthContext {
  workspaceId: string;
  apiKeyId: string;
  scopes: readonly string[];
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function extractKey(
  authHeader: string | undefined,
  apiKeyHeader: string | undefined,
): string | null {
  if (apiKeyHeader) return apiKeyHeader.trim();
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return null;
}

/**
 * Validates the API key from `Authorization: Bearer <key>` or `X-API-Key: <key>`.
 * Looks up the hashed key in api_keys, sets workspace context on c.var.auth,
 * and updates last_used_at asynchronously (best-effort).
 */
export const apiKeyAuth: MiddlewareHandler = async (c, next) => {
  const raw = extractKey(c.req.header('authorization'), c.req.header('x-api-key'));
  if (!raw) {
    return c.json({ error: 'missing_credentials', message: 'API key required' }, 401);
  }

  const db = getDb();
  const keyHash = hashKey(raw);
  const [row] = await db
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      scopes: apiKeys.scopes,
      revokedAt: apiKeys.revokedAt,
      expiresAt: apiKeys.expiresAt,
      workspaceId2: workspaces.id,
    })
    .from(apiKeys)
    .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!row) {
    return c.json({ error: 'invalid_credentials', message: 'Unknown API key' }, 401);
  }
  if (row.revokedAt) {
    return c.json({ error: 'revoked_credentials', message: 'API key has been revoked' }, 401);
  }
  if (row.expiresAt && row.expiresAt < new Date()) {
    return c.json({ error: 'expired_credentials', message: 'API key has expired' }, 401);
  }

  c.set('auth', {
    workspaceId: row.workspaceId,
    apiKeyId: row.id,
    scopes: row.scopes,
  });

  // Best-effort last_used_at update — don't block the request on it.
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch((err) => {
      console.warn('failed to update api key last_used_at', err);
    });

  await next();
};
