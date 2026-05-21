import { type ResearchRun, researchRuns } from '@mnemis/db';
import { type SQL, and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { ApiError } from '../errors.ts';
import type { CreateResearchRunInput, ListResearchRunsQuery } from '../validators/research.ts';
import { type JobDto, createJob, jobToDto } from './jobs.ts';

export interface ResearchRunDto {
  id: string;
  workspace_id: string;
  query: string;
  depth: 'quick' | 'standard' | 'deep';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  config: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreateResearchRunResult {
  data: ResearchRunDto;
  job: JobDto;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeOperationalError(message: string | null): string | null {
  if (!message) return null;
  return message
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s'"`]+/gi, '$1[redacted]')
    .replace(/(x-api-key['":\s]+)[^,'"`\s]+/gi, '$1[redacted]')
    .replace(/(api[_-]?key['":\s]+)[^,'"`\s]+/gi, '$1[redacted]')
    .replace(/(token['":\s]+)[^,'"`\s]+/gi, '$1[redacted]')
    .slice(0, 1_000);
}

export function researchRunToDto(run: ResearchRun): ResearchRunDto {
  return {
    id: run.id,
    workspace_id: run.workspaceId,
    query: run.query,
    depth: run.depth as ResearchRunDto['depth'],
    status: run.status as ResearchRunDto['status'],
    config: asRecord(run.config),
    result: run.result === null || run.result === undefined ? null : asRecord(run.result),
    error: sanitizeOperationalError(run.error),
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
    completed_at: run.completedAt?.toISOString() ?? null,
  };
}

function researchConfig(input: CreateResearchRunInput): Record<string, unknown> {
  return {
    depth: input.depth,
    maxSources: input.maxSources,
    includeWeb: input.includeWeb,
    includePapers: input.includePapers,
    includePdfs: input.includePdfs,
    index: input.index,
    urls: input.urls,
  };
}

export async function createResearchRun(
  workspaceId: string,
  input: CreateResearchRunInput,
): Promise<CreateResearchRunResult> {
  const db = getDb();
  const [run] = await db
    .insert(researchRuns)
    .values({
      workspaceId,
      query: input.query.trim(),
      depth: input.depth,
      status: 'queued',
      config: researchConfig(input),
    })
    .returning();
  if (!run) throw ApiError.internal('Research run insert returned no row');

  const job = await createJob({
    workspaceId,
    kind: 'research_run',
    payload: {
      research_run_id: run.id,
      query: run.query,
      config: run.config,
    },
  });

  return { data: researchRunToDto(run), job: jobToDto(job) };
}

function buildListWhere(workspaceId: string, filters: ListResearchRunsQuery): SQL<unknown> {
  const clauses: SQL<unknown>[] = [eq(researchRuns.workspaceId, workspaceId)];
  if (filters.status) clauses.push(eq(researchRuns.status, filters.status));
  if (filters.q) clauses.push(sql`${researchRuns.query} ILIKE ${`%${filters.q}%`}`);
  return and(...clauses) as SQL<unknown>;
}

export async function listResearchRuns(
  workspaceId: string,
  filters: ListResearchRunsQuery,
): Promise<{ items: ResearchRun[]; total: number; has_more: boolean }> {
  const db = getDb();
  const where = buildListWhere(workspaceId, filters);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(researchRuns)
    .where(where);
  const total = countRows[0]?.count ?? 0;

  const items = await db
    .select()
    .from(researchRuns)
    .where(where)
    .orderBy(desc(researchRuns.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);

  return {
    items,
    total,
    has_more: filters.offset + items.length < total,
  };
}

export async function getResearchRun(workspaceId: string, id: string): Promise<ResearchRun> {
  const db = getDb();
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.workspaceId, workspaceId), eq(researchRuns.id, id)))
    .limit(1);
  if (!run) throw ApiError.notFound('research_run');
  return run;
}
