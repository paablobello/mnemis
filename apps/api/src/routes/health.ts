import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db.ts';

export const health = new Hono();

health.get('/', async (c) => {
  const started = performance.now();
  let dbStatus: 'ok' | 'error' = 'ok';
  let dbError: string | undefined;

  try {
    await getDb().execute(sql`select 1`);
  } catch (err) {
    dbStatus = 'error';
    dbError = err instanceof Error ? err.message : String(err);
  }

  const took = Math.round(performance.now() - started);
  const allOk = dbStatus === 'ok';
  return c.json(
    {
      status: allOk ? 'ok' : 'degraded',
      version: process.env.MNEMIS_VERSION ?? '0.0.0',
      checks: {
        db: { status: dbStatus, error: dbError },
      },
      took_ms: took,
    },
    allOk ? 200 : 503,
  );
});
