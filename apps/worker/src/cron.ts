import { type Database, and, desc, eq, jobs, sources, sql } from '@mnemis/db';

const MINUTE_MS = 60_000;
const MAX_LOOKBACK_MINUTES = 366 * 24 * 60;

interface CronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
}

function parseNumber(value: string, min: number, max: number, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} contains a non-numeric value`);
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) {
    throw new Error(`${label} value ${parsed} is outside ${min}-${max}`);
  }
  return parsed;
}

function addValue(target: Set<number>, value: number, label: string): void {
  target.add(label === 'day-of-week' && value === 7 ? 0 : value);
}

const CRON_SHORTCUTS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const DAY_OF_WEEK_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

function normalizeToken(token: string, label: string): string {
  const upper = token.toUpperCase();
  if (label === 'month' && upper in MONTH_NAMES) {
    return String(MONTH_NAMES[upper]);
  }
  if (label === 'day-of-week' && upper in DAY_OF_WEEK_NAMES) {
    return String(DAY_OF_WEEK_NAMES[upper]);
  }
  return token;
}

function expandField(field: string, min: number, max: number, label: string): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    if (!part) throw new Error(`${label} contains an empty segment`);
    const [rangePart, stepPart] = part.split('/');
    if (stepPart !== undefined && !/^\d+$/.test(stepPart)) {
      throw new Error(`${label} step must be a positive integer`);
    }
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (step <= 0) throw new Error(`${label} step must be greater than zero`);

    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart?.includes('-')) {
      const [rawStart, rawEnd] = rangePart.split('-');
      if (!rawStart || !rawEnd) throw new Error(`${label} range is malformed`);
      start = parseNumber(normalizeToken(rawStart, label), min, max, label);
      end = parseNumber(normalizeToken(rawEnd, label), min, max, label);
      if (start > end) throw new Error(`${label} range start must be <= end`);
    } else if (rangePart) {
      start = parseNumber(normalizeToken(rangePart, label), min, max, label);
      end = start;
    } else {
      throw new Error(`${label} segment is malformed`);
    }

    for (let value = start; value <= end; value += step) {
      addValue(values, value, label);
    }
  }
  return values;
}

function resolveShortcut(expression: string): string {
  const trimmed = expression.trim();
  const lower = trimmed.toLowerCase();
  if (lower in CRON_SHORTCUTS) return CRON_SHORTCUTS[lower]!;
  return trimmed;
}

export function parseCronExpression(expression: string): CronSchedule {
  const resolved = resolveShortcut(expression);
  const fields = resolved.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error('cronSchedule must be a standard 5-field cron expression or a @shortcut');
  }
  return {
    minutes: expandField(fields[0]!, 0, 59, 'minute'),
    hours: expandField(fields[1]!, 0, 23, 'hour'),
    daysOfMonth: expandField(fields[2]!, 1, 31, 'day-of-month'),
    months: expandField(fields[3]!, 1, 12, 'month'),
    daysOfWeek: expandField(fields[4]!, 0, 7, 'day-of-week'),
    anyDayOfMonth: fields[2] === '*',
    anyDayOfWeek: fields[4] === '*',
  };
}

function cronMatches(schedule: CronSchedule, date: Date): boolean {
  const dayOfMonthMatches = schedule.daysOfMonth.has(date.getUTCDate());
  const dayOfWeekMatches = schedule.daysOfWeek.has(date.getUTCDay());
  const dayMatches =
    schedule.anyDayOfMonth && schedule.anyDayOfWeek
      ? true
      : schedule.anyDayOfMonth
        ? dayOfWeekMatches
        : schedule.anyDayOfWeek
          ? dayOfMonthMatches
          : dayOfMonthMatches || dayOfWeekMatches;

  return (
    schedule.minutes.has(date.getUTCMinutes()) &&
    schedule.hours.has(date.getUTCHours()) &&
    schedule.months.has(date.getUTCMonth() + 1) &&
    dayMatches
  );
}

function floorMinute(date: Date): Date {
  const floored = new Date(date);
  floored.setUTCSeconds(0, 0);
  return floored;
}

export function cronHasDueMinute(expression: string, anchor: Date, now: Date): boolean {
  const schedule = parseCronExpression(expression);
  const end = floorMinute(now).getTime();
  let cursor = floorMinute(anchor).getTime() + MINUTE_MS;
  cursor = Math.max(cursor, end - MAX_LOOKBACK_MINUTES * MINUTE_MS);
  if (cursor > end) return false;

  for (let time = cursor; time <= end; time += MINUTE_MS) {
    if (cronMatches(schedule, new Date(time))) return true;
  }
  return false;
}

function maxDate(...dates: Array<Date | null | undefined>): Date {
  const times = dates.filter(Boolean).map((date) => date!.getTime());
  return new Date(Math.max(...times));
}

async function latestIndexJobForSource(db: Database, sourceId: string) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(sql`${jobs.payload}->>'source_id' = ${sourceId}`)
    .orderBy(desc(jobs.scheduledAt))
    .limit(1);
  return job ?? null;
}

export interface EnqueueDueCronJobsOptions {
  workspaceId?: string;
}

export async function enqueueDueCronJobs(
  db: Database,
  now = new Date(),
  options: EnqueueDueCronJobsOptions = {},
): Promise<number> {
  const whereClauses = [
    eq(sources.indexStrategy, 'cron'),
    sql`${sources.cronSchedule} IS NOT NULL`,
  ];
  if (options.workspaceId) {
    whereClauses.push(eq(sources.workspaceId, options.workspaceId));
  }
  const cronSources = await db
    .select()
    .from(sources)
    .where(and(...whereClauses));

  let queued = 0;
  for (const source of cronSources) {
    const schedule = source.cronSchedule?.trim();
    if (!schedule) continue;

    const latestJob = await latestIndexJobForSource(db, source.id);
    if (latestJob?.status === 'queued' || latestJob?.status === 'processing') continue;

    const anchor = maxDate(source.createdAt, source.lastIndexedAt, latestJob?.scheduledAt);
    try {
      if (!cronHasDueMinute(schedule, anchor, now)) continue;
    } catch (err) {
      await db
        .update(sources)
        .set({
          status: 'failed',
          statusMessage: err instanceof Error ? err.message : String(err),
          updatedAt: now,
        })
        .where(eq(sources.id, source.id));
      continue;
    }

    await db.insert(jobs).values({
      workspaceId: source.workspaceId,
      kind: 'reindex_source',
      payload: {
        source_id: source.id,
        source_kind: source.kind,
        identifier: source.identifier,
        config: source.config,
      },
      progress: { done: 0, total: null, current: 'scheduled_by_cron' },
      scheduledAt: now,
    });
    await db
      .update(sources)
      .set({ status: 'pending', statusMessage: 'Cron reindex job queued', updatedAt: now })
      .where(eq(sources.id, source.id));
    queued++;
  }

  return queued;
}
