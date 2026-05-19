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
  payload: unknown;
  progress: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export function jobToDto(job: Job): JobDto {
  return {
    id: job.id,
    workspace_id: job.workspaceId,
    kind: job.kind as JobKind,
    status: job.status as JobStatus,
    payload: job.payload,
    progress: job.progress,
    result: job.result,
    error: job.error,
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
