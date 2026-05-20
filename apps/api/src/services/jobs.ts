import { type Job, jobs } from '@mnemis/db';
import { type SQL, and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { ApiError } from '../errors.ts';

export type JobKind = 'index_source' | 'reindex_source' | 'embed_chunks' | 'rerank_warmup';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface JobDto {
  id: string;
  workspace_id: string | null;
  kind: JobKind;
  status: JobStatus;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function redactConfig(config: unknown): Record<string, unknown> | undefined {
  const raw = asRecord(config);
  const safe: Record<string, unknown> = {};
  for (const key of [
    'branch',
    'includePaths',
    'excludePaths',
    'focusInstructions',
    'maxFileBytes',
    'chunkMaxChars',
    'chunkOverlapLines',
    'contextualPrefixMode',
    'contextualPrefixMaxDocumentChars',
    'contextualPrefixMaxChunkChars',
    'maxPages',
    'respectRobots',
    'docsCrawler',
  ]) {
    if (raw[key] !== undefined) safe[key] = raw[key];
  }
  if (raw.githubInstallationId !== undefined) safe.githubInstallationLinked = true;
  if (raw.localPath !== undefined) safe.localPathConfigured = true;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function redactPayload(payload: unknown): Record<string, unknown> {
  const raw = asRecord(payload);
  const safe: Record<string, unknown> = {};
  for (const key of [
    'source_id',
    'source_kind',
    'identifier',
    'github_delivery',
    'github_event',
    'github_installation_id',
    'github_ref',
    'github_branch',
    'github_after',
    'github_default_branch',
  ]) {
    if (raw[key] !== undefined) safe[key] = raw[key];
  }
  const config = redactConfig(raw.config);
  if (config) safe.config = config;
  return safe;
}

function redactResult(result: unknown): Record<string, unknown> | null {
  if (result === null || result === undefined) return null;
  const raw = asRecord(result);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (/token|secret|key|path/i.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

export function sanitizeOperationalError(message: string | null): string | null {
  if (!message) return null;
  return message
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s'"`]+/gi, '$1[redacted]')
    .replace(/(x-api-key['":\s]+)[^,'"`\s]+/gi, '$1[redacted]')
    .replace(/(api[_-]?key['":\s]+)[^,'"`\s]+/gi, '$1[redacted]')
    .replace(/(token['":\s]+)[^,'"`\s]+/gi, '$1[redacted]')
    .slice(0, 1_000);
}

export function jobToDto(job: Job): JobDto {
  return {
    id: job.id,
    workspace_id: job.workspaceId,
    kind: job.kind as JobKind,
    status: job.status as JobStatus,
    payload: redactPayload(job.payload),
    progress: asRecord(job.progress),
    result: redactResult(job.result),
    error: sanitizeOperationalError(job.error),
    attempts: job.attempts,
    scheduled_at: job.scheduledAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    completed_at: job.completedAt?.toISOString() ?? null,
  };
}

export async function createJob(input: {
  workspaceId: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  progress?: Record<string, unknown>;
  scheduledAt?: Date;
}): Promise<Job> {
  const db = getDb();
  const [job] = await db
    .insert(jobs)
    .values({
      workspaceId: input.workspaceId,
      kind: input.kind,
      payload: input.payload,
      progress: input.progress ?? { done: 0, total: null, current: null },
      scheduledAt: input.scheduledAt ?? new Date(),
    })
    .returning();

  if (!job) throw ApiError.internal('Job insert returned no row');
  return job;
}

export async function getJob(workspaceId: string, id: string): Promise<Job> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, id)) as SQL<unknown>)
    .limit(1);

  if (!job) throw ApiError.notFound('job');
  return job;
}

export async function listJobsForSource(workspaceId: string, sourceId: string): Promise<Job[]> {
  const db = getDb();
  return db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, workspaceId),
        sql`${jobs.payload}->>'source_id' = ${sourceId}`,
      ) as SQL<unknown>,
    )
    .orderBy(desc(jobs.scheduledAt));
}

export async function latestJobForSource(
  workspaceId: string,
  sourceId: string,
): Promise<Job | null> {
  const rows = await listJobsForSource(workspaceId, sourceId);
  return rows[0] ?? null;
}
