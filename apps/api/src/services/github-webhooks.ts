import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Job, type Source, githubAppInstallations, jobs, sources } from '@mnemis/db';
import { type SQL, and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { ApiError } from '../errors.ts';
import { jobToDto } from './jobs.ts';

export interface GitHubPushPayload {
  ref?: string;
  after?: string;
  repository?: {
    full_name?: string;
    default_branch?: string;
  };
  installation?: {
    id?: number | string;
  } | null;
  head_commit?: {
    id?: string;
    timestamp?: string;
  } | null;
}

export interface GitHubPushResult {
  event: 'push';
  repository: string | null;
  branch: string | null;
  installation_id: string | null;
  matched_installations: number;
  matched_sources: number;
  jobs_created: number;
  duplicate_deliveries: number;
  skipped_branch: number;
  skipped_installation: number;
  ignored_reason: string | null;
  jobs: ReturnType<typeof jobToDto>[];
}

function expectedSignature(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifyGitHubSignature(input: {
  secret: string | undefined;
  rawBody: string;
  signature: string | undefined;
}): void {
  const secret = input.secret?.trim();
  if (!secret) {
    throw ApiError.failedDependency(
      'github_webhook_secret_missing',
      'GITHUB_WEBHOOK_SECRET is not configured',
    );
  }
  if (!input.signature) {
    throw ApiError.unauthorized('Missing GitHub webhook signature');
  }

  const expected = Buffer.from(expectedSignature(secret, input.rawBody), 'utf8');
  const actual = Buffer.from(input.signature, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw ApiError.unauthorized('Invalid GitHub webhook signature');
  }
}

function branchFromRef(ref: string | undefined): string | null {
  if (!ref?.startsWith('refs/heads/')) return null;
  return ref.slice('refs/heads/'.length);
}

function installationIdFrom(payload: GitHubPushPayload): string | null {
  const id = payload.installation?.id;
  if (id === undefined || id === null) return null;
  const normalized = String(id);
  return /^\d+$/.test(normalized) ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sourceBranchMatches(
  source: Source,
  branch: string,
  defaultBranch: string | null,
): boolean {
  const config = asRecord(source.config);
  const configured = typeof config.branch === 'string' ? config.branch : null;
  if (configured) return configured === branch;
  return defaultBranch ? defaultBranch === branch : true;
}

function sourceInstallationMatches(source: Source, installationId: string): boolean {
  const config = asRecord(source.config);
  const configured =
    typeof config.githubInstallationId === 'string' ? config.githubInstallationId : null;
  return configured ? configured === installationId : true;
}

function pushedAtFrom(payload: GitHubPushPayload): Date {
  const timestamp = payload.head_commit?.timestamp;
  if (!timestamp) return new Date();
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function enqueueWebhookReindex(input: {
  source: Source;
  deliveryId: string;
  branch: string;
  payload: GitHubPushPayload;
  pushedAt: Date;
}): Promise<Job | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const lockKey = `${input.source.id}:${input.deliveryId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const duplicate = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, input.source.workspaceId),
          sql`${jobs.payload}->>'source_id' = ${input.source.id}`,
          sql`${jobs.payload}->>'github_delivery' = ${input.deliveryId}`,
        ) as SQL<unknown>,
      )
      .limit(1);
    if (duplicate[0]) return null;

    const [updated] = await tx
      .update(sources)
      .set({
        status: 'pending',
        statusMessage: 'GitHub push webhook queued reindex',
        lastChangeAt: input.pushedAt,
      })
      .where(
        and(eq(sources.workspaceId, input.source.workspaceId), eq(sources.id, input.source.id)),
      )
      .returning();

    const source = updated ?? input.source;
    const [job] = await tx
      .insert(jobs)
      .values({
        workspaceId: source.workspaceId,
        kind: 'reindex_source',
        payload: {
          source_id: source.id,
          source_kind: source.kind,
          identifier: source.identifier,
          config: source.config,
          github_delivery: input.deliveryId,
          github_event: 'push',
          github_installation_id: installationIdFrom(input.payload),
          github_ref: input.payload.ref ?? null,
          github_branch: input.branch,
          github_after: input.payload.after ?? input.payload.head_commit?.id ?? null,
          github_default_branch: input.payload.repository?.default_branch ?? null,
        },
        progress: { done: 0, total: null, current: null },
        scheduledAt: new Date(),
      })
      .returning();

    if (!job) throw ApiError.internal('Job insert returned no row');
    return job;
  });
}

export async function handleGitHubPush(
  payload: GitHubPushPayload,
  deliveryId: string,
): Promise<GitHubPushResult> {
  const repo = payload.repository?.full_name?.toLowerCase() ?? null;
  const branch = branchFromRef(payload.ref);
  const installationId = installationIdFrom(payload);
  if (!repo || !branch || !installationId) {
    return {
      event: 'push',
      repository: repo,
      branch,
      installation_id: installationId,
      matched_installations: 0,
      matched_sources: 0,
      jobs_created: 0,
      duplicate_deliveries: 0,
      skipped_branch: 0,
      skipped_installation: 0,
      ignored_reason: !installationId ? 'missing_installation' : 'invalid_push_payload',
      jobs: [],
    };
  }

  const db = getDb();
  const installations = await db
    .select({
      workspaceId: githubAppInstallations.workspaceId,
    })
    .from(githubAppInstallations)
    .where(
      and(
        eq(githubAppInstallations.installationId, installationId),
        isNull(githubAppInstallations.deletedAt),
      ),
    );

  if (installations.length === 0) {
    return {
      event: 'push',
      repository: repo,
      branch,
      installation_id: installationId,
      matched_installations: 0,
      matched_sources: 0,
      jobs_created: 0,
      duplicate_deliveries: 0,
      skipped_branch: 0,
      skipped_installation: 0,
      ignored_reason: 'unknown_installation',
      jobs: [],
    };
  }

  const workspaceIds = installations.map((installation) => installation.workspaceId);
  const candidates = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.kind, 'github_repo'),
        eq(sources.identifier, repo),
        eq(sources.indexStrategy, 'webhook'),
        inArray(sources.workspaceId, workspaceIds),
      ),
    )
    .orderBy(desc(sources.createdAt));

  const pushedAt = pushedAtFrom(payload);
  const jobsCreated: Job[] = [];
  let duplicateDeliveries = 0;
  let skippedBranch = 0;
  let skippedInstallation = 0;

  for (const source of candidates) {
    if (!sourceInstallationMatches(source, installationId)) {
      skippedInstallation++;
      continue;
    }

    if (!sourceBranchMatches(source, branch, payload.repository?.default_branch ?? null)) {
      skippedBranch++;
      continue;
    }

    const job = await enqueueWebhookReindex({
      source,
      deliveryId,
      branch,
      payload,
      pushedAt,
    });
    if (!job) {
      duplicateDeliveries++;
      continue;
    }

    jobsCreated.push(job);
  }

  return {
    event: 'push',
    repository: repo,
    branch,
    installation_id: installationId,
    matched_installations: installations.length,
    matched_sources: candidates.length,
    jobs_created: jobsCreated.length,
    duplicate_deliveries: duplicateDeliveries,
    skipped_branch: skippedBranch,
    skipped_installation: skippedInstallation,
    ignored_reason: null,
    jobs: jobsCreated.map(jobToDto),
  };
}
