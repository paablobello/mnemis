import { usageEvents } from '@mnemis/db';
import { billingPeriod, monthlyCreditLimit } from '@mnemis/saas';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { ApiError } from '../errors.ts';

function envBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function creditsEnforced(): boolean {
  return envBoolean('MNEMIS_ENFORCE_CREDITS', process.env.MNEMIS_MODE === 'cloud');
}

export async function assertCreditsAvailable(
  workspaceId: string,
  costCredits: number,
): Promise<void> {
  if (!creditsEnforced()) return;

  const { start, end } = billingPeriod();
  const [row] = await getDb()
    .select({ used: sql<number>`coalesce(sum(${usageEvents.costCredits}), 0)::int` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.workspaceId, workspaceId),
        gte(usageEvents.occurredAt, start),
        lt(usageEvents.occurredAt, end),
      ),
    );

  const used = row?.used ?? 0;
  const limit = monthlyCreditLimit();
  if (used + costCredits <= limit) return;

  throw new ApiError(402, 'credits_exhausted', 'Workspace monthly credits are exhausted', {
    credits_used: used,
    credits_limit: limit,
    credits_required: costCredits,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
  });
}
