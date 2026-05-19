/**
 * REST: /v1/admin
 *
 *   POST /v1/admin/sweep   archive memories whose expires_at <= now()
 *
 * Mounted under apiKeyAuth and gated by `admin:sweep` / `admin:*`.
 */
import { Hono } from 'hono';
import { requireScopes } from '../middleware/auth.ts';
import { sweepExpired } from '../services/memories.ts';

export const admin = new Hono();

admin.post('/sweep', requireScopes('admin:sweep'), async (c) => {
  const auth = c.get('auth');
  const result = await sweepExpired(auth.workspaceId);
  return c.json({ archived: result.archived, swept_at: new Date().toISOString() });
});
