/**
 * REST: /v1/admin
 *
 *   POST /v1/admin/sweep   archive memories whose expires_at <= now()
 *
 * Mounted under apiKeyAuth — the same key used for memories also reaches here.
 * In production this is gated by scopes (`admin:*`); for now we only check it
 * is authenticated, since self-host devs typically have a single all-scope key.
 */
import { Hono } from 'hono';
import { sweepExpired } from '../services/memories.ts';

export const admin = new Hono();

admin.post('/sweep', async (c) => {
  const result = await sweepExpired();
  return c.json({ archived: result.archived, swept_at: new Date().toISOString() });
});
