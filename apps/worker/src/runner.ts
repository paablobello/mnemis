import { randomUUID } from 'node:crypto';
import { delimiter, isAbsolute, relative, resolve } from 'node:path';
import { type Database, and, chunks, eq, inArray, jobs, sources, sql } from '@mnemis/db';
import { type IndexSourceConfig, buildDocsSiteIndex, buildLocalSourceIndex } from '@mnemis/indexer';
import { applyContextualPrefixes } from './contextual-prefix.ts';
import { enqueueDueCronJobs } from './cron.ts';
import { type EmbeddedIndexChunk, embedChunksForIndexing } from './embeddings.ts';
import { loadEnv } from './env.ts';
import { cloneGitHubRepo } from './git.ts';
import {
  GitHubAppNotConfiguredError,
  type InstallationTokenStore,
  createInstallationTokenStore,
} from './github-app.ts';
import { getActiveInstallation } from './installations.ts';

type IndexJobKind = 'index_source' | 'reindex_source';

interface RawRows<T> {
  rows?: T[];
}

interface ClaimedJob {
  id: string;
}

interface JobPayload {
  source_id?: string;
}

function rowsFrom<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return ((result as RawRows<T>).rows ?? []) as T[];
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asConfig(value: unknown): IndexSourceConfig {
  const config = asRecord(value);
  return {
    includePaths: Array.isArray(config.includePaths)
      ? (config.includePaths as string[])
      : undefined,
    excludePaths: Array.isArray(config.excludePaths)
      ? (config.excludePaths as string[])
      : undefined,
    localPath: typeof config.localPath === 'string' ? config.localPath : undefined,
    maxFileBytes: typeof config.maxFileBytes === 'number' ? config.maxFileBytes : undefined,
    chunkMaxChars: typeof config.chunkMaxChars === 'number' ? config.chunkMaxChars : undefined,
    chunkOverlapLines:
      typeof config.chunkOverlapLines === 'number' ? config.chunkOverlapLines : undefined,
    maxPages: typeof config.maxPages === 'number' ? config.maxPages : undefined,
    respectRobots: typeof config.respectRobots === 'boolean' ? config.respectRobots : undefined,
    docsCrawler:
      config.docsCrawler === 'auto' ||
      config.docsCrawler === 'native' ||
      config.docsCrawler === 'firecrawl'
        ? config.docsCrawler
        : undefined,
    focusInstructions:
      typeof config.focusInstructions === 'string' ? config.focusInstructions : undefined,
    contextualPrefixMode:
      config.contextualPrefixMode === 'auto' ||
      config.contextualPrefixMode === 'always' ||
      config.contextualPrefixMode === 'never'
        ? config.contextualPrefixMode
        : undefined,
    contextualPrefixMaxDocumentChars:
      typeof config.contextualPrefixMaxDocumentChars === 'number'
        ? config.contextualPrefixMaxDocumentChars
        : undefined,
    contextualPrefixMaxChunkChars:
      typeof config.contextualPrefixMaxChunkChars === 'number'
        ? config.contextualPrefixMaxChunkChars
        : undefined,
  };
}

function sanitizeOperationalError(error: unknown, max = 1_000): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s'"`]+/gi, '$1[redacted]')
    .replace(/(x-api-key['":\s]+)[^,'"`\s]+/gi, '$1[redacted]')
    .replace(/(api[_-]?key['":\s]+)[^,'"`\s]+/gi, '$1[redacted]')
    .replace(/(token['":\s]+)[^,'"`\s]+/gi, '$1[redacted]')
    .slice(0, max);
}

function localSourceRoots(): string[] {
  return (process.env.MNEMIS_LOCAL_SOURCE_ROOTS ?? '')
    .split(delimiter)
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => resolve(root));
}

function isPathUnderRoot(path: string, root: string): boolean {
  const resolved = resolve(path);
  const relativePath = relative(root, resolved);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function assertLocalPathAllowed(localPath: string): void {
  const env = loadEnv();
  if (env.MNEMIS_MODE === 'cloud') {
    throw new Error(
      'local_sources_disabled: config.localPath is not allowed when MNEMIS_MODE=cloud',
    );
  }
  if (!env.MNEMIS_ALLOW_LOCAL_SOURCES) {
    throw new Error(
      'local_sources_disabled: config.localPath is only allowed when MNEMIS_ALLOW_LOCAL_SOURCES=true',
    );
  }
  const roots = localSourceRoots();
  if (roots.length === 0) {
    throw new Error(
      'local_source_roots_required: MNEMIS_LOCAL_SOURCE_ROOTS must allowlist localPath roots',
    );
  }
  if (!roots.some((root) => isPathUnderRoot(localPath, root))) {
    throw new Error(
      'local_source_path_not_allowed: config.localPath must be under MNEMIS_LOCAL_SOURCE_ROOTS',
    );
  }
}

async function updateJobProgress(
  db: Database,
  jobId: string,
  progress: Record<string, unknown>,
): Promise<void> {
  await db.update(jobs).set({ progress }).where(eq(jobs.id, jobId));
}

export async function claimNextIndexJob(db: Database): Promise<string | null> {
  const result = await db.execute(sql<ClaimedJob>`
    WITH picked AS (
      SELECT id
      FROM jobs
      WHERE status = 'queued'
        AND kind IN ('index_source', 'reindex_source')
        AND scheduled_at <= now()
      ORDER BY scheduled_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs
    SET status = 'processing',
        started_at = COALESCE(started_at, now()),
        attempts = attempts + 1,
        progress = jsonb_build_object('done', 0, 'total', NULL, 'current', 'claiming')
    FROM picked
    WHERE jobs.id = picked.id
    RETURNING jobs.id
  `);

  return rowsFrom<ClaimedJob>(result)[0]?.id ?? null;
}

export async function reapStaleIndexJobs(
  db: Database,
  options: { now?: Date; staleAfterMs?: number; maxAttempts?: number } = {},
): Promise<{ requeued: number; failed: number }> {
  const env = loadEnv();
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? env.JOB_STALE_AFTER_MS;
  const maxAttempts = options.maxAttempts ?? env.JOB_MAX_ATTEMPTS;
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const nowSql = sql`${now.toISOString()}::timestamptz`;
  const staleBeforeSql = sql`${staleBefore.toISOString()}::timestamptz`;

  const requeued = await db
    .update(jobs)
    .set({
      status: 'queued',
      startedAt: null,
      scheduledAt: nowSql,
      progress: { done: 0, total: null, current: 'requeued_after_stale_processing' },
      error: 'job_requeued_after_stale_processing',
    })
    .where(
      and(
        eq(jobs.status, 'processing'),
        inArray(jobs.kind, ['index_source', 'reindex_source']),
        sql`${jobs.startedAt} IS NOT NULL`,
        sql`${jobs.startedAt} <= ${staleBeforeSql}`,
        sql`${jobs.attempts} < ${maxAttempts}`,
      ),
    )
    .returning({ id: jobs.id });

  const failed = await db
    .update(jobs)
    .set({
      status: 'failed',
      completedAt: nowSql,
      progress: { done: 0, total: null, current: 'failed_stale_max_attempts' },
      error: 'job_failed_after_stale_max_attempts',
    })
    .where(
      and(
        eq(jobs.status, 'processing'),
        inArray(jobs.kind, ['index_source', 'reindex_source']),
        sql`${jobs.startedAt} IS NOT NULL`,
        sql`${jobs.startedAt} <= ${staleBeforeSql}`,
        sql`${jobs.attempts} >= ${maxAttempts}`,
      ),
    )
    .returning({ id: jobs.id });

  return { requeued: requeued.length, failed: failed.length };
}

async function getClaimedJob(db: Database, jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error(`Claimed job disappeared: ${jobId}`);
  return job;
}

async function loadSourceForJob(db: Database, workspaceId: string, sourceId: string) {
  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.workspaceId, workspaceId), eq(sources.id, sourceId)))
    .limit(1);
  if (!source) throw new Error(`Source not found for job: ${sourceId}`);
  return source;
}

let defaultTokenStore: InstallationTokenStore | null = null;

function getDefaultTokenStore(): InstallationTokenStore {
  if (defaultTokenStore) return defaultTokenStore;
  const env = loadEnv();
  defaultTokenStore = createInstallationTokenStore({
    appId: env.GITHUB_APP_ID ?? null,
    privateKey: env.GITHUB_APP_PRIVATE_KEY ?? null,
  });
  return defaultTokenStore;
}

async function resolveGitHubToken(
  db: Database,
  workspaceId: string,
  installationId: string,
  tokenStore: InstallationTokenStore,
): Promise<string> {
  const installation = await getActiveInstallation(db, workspaceId, installationId);
  if (!installation) {
    throw new Error(
      `GitHub App installation ${installationId} is not linked to this workspace (or was removed)`,
    );
  }
  if (installation.suspendedAt) {
    throw new Error(`GitHub App installation ${installationId} is suspended`);
  }
  try {
    return await tokenStore.getInstallationToken(installationId);
  } catch (err) {
    if (err instanceof GitHubAppNotConfiguredError) {
      throw new Error(
        'github_app_not_configured: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY to index private GitHub repos',
      );
    }
    throw err;
  }
}

async function buildSourceIndex(
  db: Database,
  source: Awaited<ReturnType<typeof loadSourceForJob>>,
  tokenStore: InstallationTokenStore,
) {
  const config = asConfig(source.config);

  if (config.localPath) {
    assertLocalPathAllowed(config.localPath);
    const index = await buildLocalSourceIndex(config.localPath, config);
    return { ...index, commitSha: null as string | null };
  }

  if (source.kind === 'github_repo') {
    const sourceConfig = asRecord(source.config);
    const branch =
      typeof sourceConfig.branch === 'string' ? String(sourceConfig.branch) : undefined;
    const installationId =
      typeof sourceConfig.githubInstallationId === 'string'
        ? sourceConfig.githubInstallationId
        : null;
    const token = installationId
      ? await resolveGitHubToken(db, source.workspaceId, installationId, tokenStore)
      : undefined;
    const cloned = await cloneGitHubRepo(source.identifier, { branch, token });
    try {
      const index = await buildLocalSourceIndex(cloned.path, config);
      return { ...index, commitSha: cloned.commitSha };
    } finally {
      await cloned.cleanup();
    }
  }

  if (source.kind === 'docs_site') {
    const index = await buildDocsSiteIndex(source.identifier, config);
    return { ...index, commitSha: null as string | null };
  }

  throw new Error(`Unsupported source kind: ${source.kind}`);
}

function chunkInsertValues(input: {
  workspaceId: string;
  sourceId: string;
  runId: string;
  chunks: EmbeddedIndexChunk[];
  parentIdsByKey?: Map<string, string>;
  commitSha?: string | null;
}): (typeof chunks.$inferInsert)[] {
  return input.chunks.map((chunk) => ({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    parentId: chunk.parentKey ? input.parentIdsByKey?.get(chunk.parentKey) : undefined,
    path: chunk.path,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
    sectionPath: chunk.sectionPath,
    rawText: chunk.rawText,
    contextualPrefix: chunk.contextualPrefix,
    language: chunk.language,
    embedding: chunk.embedding,
    metadata: {
      ...chunk.metadata,
      index_run_id: input.runId,
      ...(input.commitSha ? { commit_sha: input.commitSha } : {}),
      ...(chunk.chunkKey ? { chunk_key: chunk.chunkKey } : {}),
      ...(chunk.parentKey ? { parent_key: chunk.parentKey } : {}),
      ...(chunk.embeddingModel
        ? {
            embedding_model: chunk.embeddingModel,
            embedding_text_hash: chunk.embeddingTextHash,
          }
        : {}),
    },
    indexedAt: new Date(),
  }));
}

async function upsertChunkBatch(input: {
  db: Database;
  values: (typeof chunks.$inferInsert)[];
}): Promise<number> {
  const batchSize = 250;
  let upserted = 0;

  for (let start = 0; start < input.values.length; start += batchSize) {
    const batch = input.values.slice(start, start + batchSize);
    if (batch.length === 0) continue;
    await input.db
      .insert(chunks)
      .values(batch)
      .onConflictDoUpdate({
        target: [chunks.sourceId, chunks.path, chunks.lineStart, chunks.lineEnd],
        set: {
          parentId: sql`excluded.parent_id`,
          rawText: sql`excluded.raw_text`,
          contextualPrefix: sql`excluded.contextual_prefix`,
          language: sql`excluded.language`,
          sectionPath: sql`excluded.section_path`,
          embedding: sql`excluded.embedding`,
          metadata: sql`excluded.metadata`,
          indexedAt: sql`excluded.indexed_at`,
        },
      });
    upserted += batch.length;
  }

  return upserted;
}

async function loadParentIdsByKey(input: {
  db: Database;
  workspaceId: string;
  sourceId: string;
  parentKeys: string[];
}): Promise<Map<string, string>> {
  if (input.parentKeys.length === 0) return new Map();

  const rows = await input.db
    .select({
      id: chunks.id,
      key: sql<string>`${chunks.metadata}->>'chunk_key'`,
    })
    .from(chunks)
    .where(
      and(
        eq(chunks.workspaceId, input.workspaceId),
        eq(chunks.sourceId, input.sourceId),
        inArray(sql<string>`${chunks.metadata}->>'chunk_key'`, input.parentKeys),
      ),
    );

  return new Map(rows.map((row) => [row.key, row.id]));
}

async function upsertChunks(input: {
  db: Database;
  workspaceId: string;
  sourceId: string;
  runId: string;
  chunks: EmbeddedIndexChunk[];
  commitSha?: string | null;
}): Promise<{ upserted: number; deleted: number }> {
  const parentOrRootChunks = input.chunks.filter((chunk) => !chunk.parentKey);
  const childChunks = input.chunks.filter((chunk) => chunk.parentKey);
  const parentValues = chunkInsertValues({ ...input, chunks: parentOrRootChunks });
  let upserted = await upsertChunkBatch({ db: input.db, values: parentValues });

  const parentKeys = [
    ...new Set(childChunks.map((chunk) => chunk.parentKey).filter((key): key is string => !!key)),
  ];
  const parentIdsByKey = await loadParentIdsByKey({
    db: input.db,
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    parentKeys,
  });

  const childValues = chunkInsertValues({
    ...input,
    chunks: childChunks,
    parentIdsByKey,
  });
  upserted += await upsertChunkBatch({ db: input.db, values: childValues });

  const stale = await input.db
    .delete(chunks)
    .where(
      and(
        eq(chunks.workspaceId, input.workspaceId),
        eq(chunks.sourceId, input.sourceId),
        sql`coalesce(${chunks.metadata}->>'index_run_id', '') <> ${input.runId}`,
      ),
    )
    .returning({ id: chunks.id });

  return { upserted, deleted: stale.length };
}

async function markJobCompleted(
  db: Database,
  jobId: string,
  result: Record<string, unknown>,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: 'completed',
      completedAt: new Date(),
      progress: { done: result.chunks, total: result.chunks, current: 'completed' },
      result,
      error: null,
    })
    .where(eq(jobs.id, jobId));
}

async function markJobFailed(db: Database, jobId: string, error: unknown): Promise<void> {
  const message = sanitizeOperationalError(error, 4_000);
  await db
    .update(jobs)
    .set({
      status: 'failed',
      completedAt: new Date(),
      progress: { done: 0, total: null, current: 'failed' },
      error: message.slice(0, 4_000),
    })
    .where(eq(jobs.id, jobId));
}

export async function processIndexJob(
  db: Database,
  jobId: string,
  tokenStore: InstallationTokenStore = getDefaultTokenStore(),
): Promise<void> {
  const job = await getClaimedJob(db, jobId);
  let source: Awaited<ReturnType<typeof loadSourceForJob>> | null = null;

  try {
    const workspaceId = job.workspaceId;
    if (!workspaceId) throw new Error('Index job has no workspace_id');
    if (job.kind !== 'index_source' && job.kind !== 'reindex_source') {
      throw new Error(`Unsupported job kind: ${job.kind}`);
    }

    const payload = asRecord(job.payload) as JobPayload;
    if (!payload.source_id) throw new Error('Index job payload missing source_id');

    source = await loadSourceForJob(db, workspaceId, payload.source_id);
    await db
      .update(sources)
      .set({ status: 'indexing', statusMessage: 'Indexing source' })
      .where(eq(sources.id, source.id));

    await updateJobProgress(db, jobId, { done: 0, total: null, current: 'loading_files' });
    const index = await buildSourceIndex(db, source, tokenStore);
    await updateJobProgress(db, jobId, {
      done: 0,
      total: index.chunks.length,
      current: 'contextualizing_chunks',
    });
    const contextualized = await applyContextualPrefixes({
      sourceKind: source.kind as 'github_repo' | 'docs_site',
      files: index.files,
      chunks: index.chunks,
      config: asConfig(source.config),
    });

    await updateJobProgress(db, jobId, {
      done: 0,
      total: contextualized.chunks.length,
      current: 'embedding_chunks',
    });
    const embedded = await embedChunksForIndexing(contextualized.chunks);

    await updateJobProgress(db, jobId, {
      done: 0,
      total: embedded.chunks.length,
      current: 'upserting_chunks',
    });

    const runId = randomUUID();
    const result = await upsertChunks({
      db,
      workspaceId,
      sourceId: source.id,
      runId,
      chunks: embedded.chunks,
      commitSha: index.commitSha,
    });

    await db
      .update(sources)
      .set({
        status: 'indexed',
        statusMessage: null,
        lastIndexedAt: new Date(),
        lastChangeAt: index.lastChangeAt,
      })
      .where(eq(sources.id, source.id));

    await markJobCompleted(db, jobId, {
      files: index.files.length,
      chunks: index.chunks.length,
      commit_sha: index.commitSha,
      chunks_contextualized: contextualized.stats.generated,
      contextual_prefix_model: contextualized.stats.model,
      contextual_prefix_mode: contextualized.stats.mode,
      contextual_prefix_input_tokens: contextualized.stats.inputTokens,
      contextual_prefix_output_tokens: contextualized.stats.outputTokens,
      contextual_prefix_cache_creation_input_tokens: contextualized.stats.cacheCreationInputTokens,
      contextual_prefix_cache_read_input_tokens: contextualized.stats.cacheReadInputTokens,
      contextual_prefix_skipped_reason: contextualized.stats.skippedReason,
      chunks_upserted: result.upserted,
      stale_chunks_deleted: result.deleted,
      chunks_embedded: embedded.stats.embedded,
      embedding_model_counts: embedded.stats.modelCounts,
      embedding_tokens: embedded.stats.totalTokens,
      embedding_cache_hits: embedded.stats.cacheHits,
      embedding_skipped_reason: embedded.stats.skippedReason,
    });
  } catch (err) {
    if (source) {
      await db
        .update(sources)
        .set({
          status: 'failed',
          statusMessage: sanitizeOperationalError(err),
        })
        .where(eq(sources.id, source.id));
    }
    await markJobFailed(db, jobId, err);
  }
}

export async function processOneJob(
  db: Database,
  tokenStore: InstallationTokenStore = getDefaultTokenStore(),
): Promise<boolean> {
  await reapStaleIndexJobs(db);
  const jobId = await claimNextIndexJob(db);
  if (!jobId) return false;
  await processIndexJob(db, jobId, tokenStore);
  return true;
}

export async function runWorkerLoop(input: {
  db: Database;
  pollIntervalMs: number;
  once?: boolean;
  onError?: (err: unknown) => void;
  tokenStore?: InstallationTokenStore;
}): Promise<void> {
  const tokenStore = input.tokenStore ?? getDefaultTokenStore();
  while (true) {
    try {
      await enqueueDueCronJobs(input.db);
      const processed = await processOneJob(input.db, tokenStore);
      if (input.once) return;
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs));
      }
    } catch (err) {
      input.onError?.(err);
      if (input.once) throw err;
      await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs));
    }
  }
}
