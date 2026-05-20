import { type Job, type Source, chunks, sources } from '@mnemis/db';
import { type SQL, and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { ApiError } from '../errors.ts';
import type { CreateSourceInput, SourceKindInput } from '../validators/sources.ts';
import { getActiveGitHubInstallation } from './github-installations.ts';
import { type JobDto, createJob, jobToDto, latestJobForSource } from './jobs.ts';

export interface SourceDto {
  id: string;
  kind: SourceKindInput;
  identifier: string;
  display_name: string;
  config: unknown;
  last_indexed_at: string | null;
  last_change_at: string | null;
  index_strategy: string;
  cron_schedule: string | null;
  status: string;
  status_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceStatusDto {
  source: SourceDto;
  chunk_count: number;
  latest_job: JobDto | null;
}

export function sourceToDto(source: Source): SourceDto {
  return {
    id: source.id,
    kind: source.kind as SourceKindInput,
    identifier: source.identifier,
    display_name: source.displayName,
    config: source.config,
    last_indexed_at: source.lastIndexedAt?.toISOString() ?? null,
    last_change_at: source.lastChangeAt?.toISOString() ?? null,
    index_strategy: source.indexStrategy,
    cron_schedule: source.cronSchedule,
    status: source.status,
    status_message: source.statusMessage,
    created_at: source.createdAt.toISOString(),
    updated_at: source.updatedAt.toISOString(),
  };
}

function normalizeIdentifier(kind: SourceKindInput, identifier: string): string {
  const trimmed = identifier.trim();
  if (kind === 'github_repo') return trimmed.toLowerCase();
  const url = new URL(trimmed);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function defaultDisplayName(kind: SourceKindInput, identifier: string): string {
  if (kind === 'github_repo') return identifier;
  return new URL(identifier).hostname;
}

function indexJobPayload(source: Source): Record<string, unknown> {
  return {
    source_id: source.id,
    source_kind: source.kind,
    identifier: source.identifier,
    config: source.config,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localSourcesEnabled(): boolean {
  return process.env.MNEMIS_ALLOW_LOCAL_SOURCES === 'true';
}

async function validateSourceConfig(workspaceId: string, input: CreateSourceInput): Promise<void> {
  const config = asRecord(input.config);
  if (typeof config.localPath === 'string' && !localSourcesEnabled()) {
    throw ApiError.badRequest(
      'local_sources_disabled',
      'config.localPath is only allowed when MNEMIS_ALLOW_LOCAL_SOURCES=true',
    );
  }

  if (input.kind !== 'github_repo') return;

  const installationId =
    typeof config.githubInstallationId === 'string' ? config.githubInstallationId : null;
  if (!installationId) return;

  const installation = await getActiveGitHubInstallation(workspaceId, installationId);
  if (!installation) {
    throw ApiError.badRequest(
      'github_installation_not_found',
      'config.githubInstallationId must reference a GitHub App installation linked to this workspace',
    );
  }
}

async function enqueueSourceJob(
  workspaceId: string,
  source: Source,
  kind: 'index_source' | 'reindex_source',
): Promise<Job> {
  return createJob({
    workspaceId,
    kind,
    payload: indexJobPayload(source),
  });
}

export async function createSource(
  workspaceId: string,
  input: CreateSourceInput,
): Promise<{ source: Source; job: Job | null }> {
  const db = getDb();
  const identifier = normalizeIdentifier(input.kind, input.identifier);
  await validateSourceConfig(workspaceId, input);

  const existing = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.workspaceId, workspaceId), eq(sources.identifier, identifier)))
    .limit(1);
  if (existing[0]) {
    throw ApiError.conflict('source_exists', 'A source with this identifier already exists');
  }

  const [source] = await db
    .insert(sources)
    .values({
      workspaceId,
      kind: input.kind,
      identifier,
      displayName: input.displayName ?? defaultDisplayName(input.kind, identifier),
      config: (input.config ?? {}) as Record<string, unknown>,
      indexStrategy: input.indexStrategy,
      cronSchedule: input.indexStrategy === 'cron' ? (input.cronSchedule ?? null) : null,
      status: input.enqueue ? 'pending' : 'pending',
      statusMessage: input.enqueue ? 'Index job queued' : 'Source registered',
    })
    .returning();

  if (!source) throw ApiError.internal('Source insert returned no row');

  const job = input.enqueue ? await enqueueSourceJob(workspaceId, source, 'index_source') : null;
  return { source, job };
}

export interface ListSourcesFilters {
  kind?: SourceKindInput;
  status?: string;
  q?: string;
  limit: number;
  offset: number;
}

function buildListWhere(workspaceId: string, filters: ListSourcesFilters): SQL<unknown> {
  const clauses: SQL<unknown>[] = [eq(sources.workspaceId, workspaceId)];
  if (filters.kind) clauses.push(eq(sources.kind, filters.kind));
  if (filters.status) clauses.push(eq(sources.status, filters.status));
  if (filters.q) {
    clauses.push(
      sql`(${sources.identifier} ILIKE ${`%${filters.q}%`} OR ${sources.displayName} ILIKE ${`%${filters.q}%`})`,
    );
  }
  return and(...clauses) as SQL<unknown>;
}

export async function listSources(
  workspaceId: string,
  filters: ListSourcesFilters,
): Promise<{ items: Source[]; total: number; has_more: boolean }> {
  const db = getDb();
  const where = buildListWhere(workspaceId, filters);

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sources)
    .where(where);
  const total = countRows[0]?.count ?? 0;

  const items = await db
    .select()
    .from(sources)
    .where(where)
    .orderBy(desc(sources.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);

  return {
    items,
    total,
    has_more: filters.offset + items.length < total,
  };
}

export async function getSource(workspaceId: string, id: string): Promise<Source> {
  const db = getDb();
  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.workspaceId, workspaceId), eq(sources.id, id)))
    .limit(1);
  if (!source) throw ApiError.notFound('source');
  return source;
}

export async function getSourceStatus(workspaceId: string, id: string): Promise<SourceStatusDto> {
  const db = getDb();
  const source = await getSource(workspaceId, id);
  const [count] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chunks)
    .where(and(eq(chunks.workspaceId, workspaceId), eq(chunks.sourceId, id)));
  const latestJob = await latestJobForSource(workspaceId, id);

  return {
    source: sourceToDto(source),
    chunk_count: count?.count ?? 0,
    latest_job: latestJob ? jobToDto(latestJob) : null,
  };
}

export async function enqueueReindex(workspaceId: string, id: string): Promise<{ job: Job }> {
  const db = getDb();
  const source = await getSource(workspaceId, id);
  const [updated] = await db
    .update(sources)
    .set({ status: 'pending', statusMessage: 'Reindex job queued' })
    .where(and(eq(sources.workspaceId, workspaceId), eq(sources.id, id)))
    .returning();

  const job = await enqueueSourceJob(workspaceId, updated ?? source, 'reindex_source');
  return { job };
}
