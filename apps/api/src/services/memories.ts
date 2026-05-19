/**
 * Memory business logic. Routes are thin — they validate input, call here,
 * and serialize the response. All workspace scoping happens in this layer
 * (every method takes `workspaceId`).
 */
import { type Memory, memories } from '@mnemis/db';
import { type SQL, and, arrayContains, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { ApiError } from '../errors.ts';
import {
  type CreateMemoryInput,
  type MemoryKindInput,
  TTL_DEFAULTS,
} from '../validators/memories.ts';
import { getEmbeddings } from './embeddings.ts';

/* ----------------------------------------------------------------------------
 *  Public DTO
 * --------------------------------------------------------------------------*/
export interface MemoryDto {
  id: string;
  kind: MemoryKindInput;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  directory: string | null;
  file_overlap: string[];
  ttl_seconds: number | null;
  expires_at: string | null;
  archived_at: string | null;
  agent_origin: string | null;
  created_at: string;
  updated_at: string;
  has_embedding: boolean;
  lineage?: {
    source_ids: string[];
    derived_from: string | null;
    confidence: number | null;
    tool_calls: unknown;
    model_version: string | null;
    edited_files: unknown;
  };
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface ProjectionOpts {
  includeLineage?: boolean;
  includeEmbedding?: boolean;
}

export function toDto(m: Memory, opts: ProjectionOpts = {}): MemoryDto {
  const dto: MemoryDto = {
    id: m.id,
    kind: m.kind as MemoryKindInput,
    title: m.title,
    summary: m.summary,
    body: m.body,
    tags: m.tags,
    directory: m.directory,
    file_overlap: m.fileOverlap,
    ttl_seconds: m.ttlSeconds,
    expires_at: m.expiresAt?.toISOString() ?? null,
    archived_at: m.archivedAt?.toISOString() ?? null,
    agent_origin: m.agentOrigin,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
    has_embedding: m.embedding !== null && m.embedding !== undefined,
    metadata: (m.metadata as Record<string, unknown>) ?? {},
  };

  if (opts.includeLineage) {
    dto.lineage = {
      source_ids: m.sourceIds,
      derived_from: m.derivedFrom,
      confidence: m.confidence,
      tool_calls: m.toolCalls,
      model_version: m.modelVersion,
      edited_files: m.editedFiles,
    };
  }
  if (opts.includeEmbedding && m.embedding) {
    dto.embedding = m.embedding as unknown as number[];
  }
  return dto;
}

/* ----------------------------------------------------------------------------
 *  Embedding helper
 *
 *  We embed the *concatenated* projection (title + summary + body) with
 *  voyage-3.5-large + input_type='document'. This matches what we will embed
 *  at search time with input_type='query', so cosine distance is meaningful.
 * --------------------------------------------------------------------------*/
function embedSourceFor(input: { title: string; summary: string; body: string }): string {
  return `${input.title}\n\n${input.summary}\n\n${input.body}`.trim();
}

async function maybeEmbed(input: CreateMemoryInput): Promise<{
  vector: number[] | null;
  modelVersion: string | null;
}> {
  const client = getEmbeddings();
  if (!client) return { vector: null, modelVersion: null };

  const text = embedSourceFor(input);
  const result = await client.embed(text, { inputType: 'document' });
  return { vector: result.vector, modelVersion: result.model };
}

/* ----------------------------------------------------------------------------
 *  Create
 * --------------------------------------------------------------------------*/
export async function createMemory(workspaceId: string, input: CreateMemoryInput): Promise<Memory> {
  const db = getDb();

  const ttl = input.ttlSeconds === undefined ? TTL_DEFAULTS[input.kind] : input.ttlSeconds;

  const { vector, modelVersion } = await maybeEmbed(input);

  const [created] = await db
    .insert(memories)
    .values({
      workspaceId,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      body: input.body,
      tags: input.tags ?? [],
      directory: input.directory ?? null,
      fileOverlap: input.fileOverlap ?? [],
      ttlSeconds: ttl ?? null,
      agentOrigin: input.agentOrigin ?? null,
      sourceIds: input.sourceIds ?? [],
      derivedFrom: input.derivedFrom ?? null,
      confidence: input.confidence ?? null,
      toolCalls: input.toolCalls ?? [],
      modelVersion: input.modelVersion ?? modelVersion ?? null,
      editedFiles: input.editedFiles ?? [],
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
      embedding: vector,
    })
    .returning();

  if (!created) throw ApiError.internal('Memory insert returned no row');
  return created;
}

/* ----------------------------------------------------------------------------
 *  Read
 * --------------------------------------------------------------------------*/
export async function getMemory(workspaceId: string, id: string): Promise<Memory> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(memories)
    .where(and(eq(memories.workspaceId, workspaceId), eq(memories.id, id)))
    .limit(1);
  if (!row) throw ApiError.notFound('memory');
  return row;
}

export interface ListFilters {
  kind?: MemoryKindInput;
  tag?: string;
  directory?: string;
  agentOrigin?: string;
  q?: string;
  includeArchived?: boolean;
  includeExpired?: boolean;
  limit: number;
  offset: number;
  createdAfter?: string;
  createdBefore?: string;
}

export interface ListResult {
  items: Memory[];
  total: number;
  has_more: boolean;
}

export async function listMemories(workspaceId: string, filters: ListFilters): Promise<ListResult> {
  const db = getDb();
  const where = buildListWhere(workspaceId, filters);

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(where);
  const count = countRows[0]?.count ?? 0;

  const items = await db
    .select()
    .from(memories)
    .where(where)
    .orderBy(desc(memories.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);

  return {
    items,
    total: count,
    has_more: filters.offset + items.length < count,
  };
}

function buildListWhere(workspaceId: string, f: ListFilters): SQL<unknown> {
  const clauses: SQL<unknown>[] = [eq(memories.workspaceId, workspaceId)];

  if (!f.includeArchived) clauses.push(isNull(memories.archivedAt));
  if (!f.includeExpired) {
    clauses.push(
      or(isNull(memories.expiresAt), gt(memories.expiresAt, sql`now()`)) as SQL<unknown>,
    );
  }
  if (f.kind) clauses.push(eq(memories.kind, f.kind));
  if (f.directory) clauses.push(eq(memories.directory, f.directory));
  if (f.agentOrigin) clauses.push(eq(memories.agentOrigin, f.agentOrigin));
  if (f.tag) clauses.push(arrayContains(memories.tags, [f.tag]));
  if (f.createdAfter) clauses.push(sql`${memories.createdAt} > ${f.createdAfter}::timestamptz`);
  if (f.createdBefore) clauses.push(sql`${memories.createdAt} < ${f.createdBefore}::timestamptz`);
  if (f.q) {
    // simple ILIKE fallback for the list endpoint; real ranking lives in /search
    clauses.push(
      or(
        ilike(memories.title, `%${f.q}%`),
        ilike(memories.summary, `%${f.q}%`),
        ilike(memories.body, `%${f.q}%`),
      ) as SQL<unknown>,
    );
  }
  return and(...clauses) as SQL<unknown>;
}

/* ----------------------------------------------------------------------------
 *  Patch (metadata-only)
 * --------------------------------------------------------------------------*/
export interface PatchInput {
  kind?: MemoryKindInput;
  tags?: string[];
  ttlSeconds?: number | null;
  archived?: boolean;
  metadata?: Record<string, unknown>;
}

export async function patchMemory(
  workspaceId: string,
  id: string,
  input: PatchInput,
): Promise<Memory> {
  const db = getDb();

  const update: Partial<typeof memories.$inferInsert> = {};
  if (input.kind !== undefined) update.kind = input.kind;
  if (input.tags !== undefined) update.tags = input.tags;
  if (input.ttlSeconds !== undefined) update.ttlSeconds = input.ttlSeconds;
  if (input.metadata !== undefined) update.metadata = input.metadata;
  if (input.archived !== undefined) {
    update.archivedAt = input.archived ? new Date() : null;
  }

  const [row] = await db
    .update(memories)
    .set(update)
    .where(and(eq(memories.workspaceId, workspaceId), eq(memories.id, id)))
    .returning();
  if (!row) throw ApiError.notFound('memory');
  return row;
}

/* ----------------------------------------------------------------------------
 *  Delete (soft by default)
 * --------------------------------------------------------------------------*/
export async function deleteMemory(
  workspaceId: string,
  id: string,
  opts: { permanent?: boolean } = {},
): Promise<void> {
  const db = getDb();
  if (opts.permanent) {
    const result = await db
      .delete(memories)
      .where(and(eq(memories.workspaceId, workspaceId), eq(memories.id, id)))
      .returning({ id: memories.id });
    if (result.length === 0) throw ApiError.notFound('memory');
    return;
  }
  const [row] = await db
    .update(memories)
    .set({ archivedAt: new Date() })
    .where(and(eq(memories.workspaceId, workspaceId), eq(memories.id, id)))
    .returning({ id: memories.id });
  if (!row) throw ApiError.notFound('memory');
}

/* ----------------------------------------------------------------------------
 *  Sweep — used by Sprint 2.5 cron job
 * --------------------------------------------------------------------------*/
export async function sweepExpired(workspaceId: string): Promise<{ archived: number }> {
  const db = getDb();
  const result = await db
    .update(memories)
    .set({ archivedAt: sql`now()` })
    .where(
      and(
        eq(memories.workspaceId, workspaceId),
        isNull(memories.archivedAt),
        sql`${memories.expiresAt} IS NOT NULL`,
        sql`${memories.expiresAt} <= now()`,
      ),
    )
    .returning({ id: memories.id });
  return { archived: result.length };
}
