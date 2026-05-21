import { type Database, usageEvents } from '@mnemis/db';
import type { Context } from 'hono';
import { getDb } from '../db.ts';

export type UsageKind =
  | 'request'
  | 'search'
  | 'save'
  | 'index'
  | 'research'
  | 'rerank'
  | 'synthesize';

export async function recordUsage(
  c: Context,
  kind: UsageKind,
  costCredits = 1,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await recordUsageWithDb(getDb(), c, kind, costCredits, metadata);
}

export async function recordUsageWithDb(
  db: Database,
  c: Context,
  kind: UsageKind,
  costCredits = 1,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const auth = c.get('auth');
  await db
    .insert(usageEvents)
    .values({
      workspaceId: auth.workspaceId,
      apiKeyId: auth.apiKeyId,
      kind,
      costCredits,
      metadata,
    })
    .catch((err) => {
      console.warn('failed to record usage event', err);
    });
}
