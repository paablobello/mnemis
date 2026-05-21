import { randomBytes } from 'node:crypto';
import {
  type ApiKey,
  type Plan,
  type Source,
  type Subscription,
  type User,
  type Workspace,
  and,
  apiKeyHash,
  apiKeyPrefix,
  apiKeys,
  chunks,
  type createDatabase,
  desc,
  eq,
  gte,
  inArray,
  jobs,
  lt,
  memories,
  or,
  plans,
  researchRuns,
  sources,
  sql,
  subscriptions,
  usageEvents,
  users,
  workspaceMembers,
  workspaces,
} from '@mnemis/db';

export type Database = ReturnType<typeof createDatabase>;

export interface SaasIdentity {
  provider: 'clerk';
  externalId: string;
  email: string;
  name?: string | null;
  workspaceExternalId?: string | null;
  workspaceName?: string | null;
}

export interface SaasWorkspaceContext {
  user: User;
  workspace: Workspace;
  role: string;
}

export interface UsageSummary {
  period_start: string;
  period_end: string;
  credits_used: number;
  credits_limit: number;
  credits_remaining: number;
  credits_unlimited: boolean;
  requests: number;
}

export interface QuotaSummary {
  used: number;
  max: number | null;
}

export interface DashboardSnapshot {
  user: User;
  workspace: Workspace;
  role: string;
  plan: Plan;
  subscription: Pick<
    Subscription,
    'status' | 'stripePriceId' | 'currentPeriodStart' | 'currentPeriodEnd' | 'cancelAtPeriodEnd'
  > | null;
  usage: UsageSummary;
  quotas: {
    sources: QuotaSummary;
    research_runs: QuotaSummary;
  };
  counts: {
    sources: number;
    indexed_sources: number;
    failed_sources: number;
    research_runs: number;
    queued_jobs: number;
    failed_jobs: number;
    memories: number;
    chunks: number;
  };
  api_keys: Array<
    Pick<
      ApiKey,
      'id' | 'name' | 'prefix' | 'scopes' | 'lastUsedAt' | 'expiresAt' | 'createdAt' | 'revokedAt'
    >
  >;
  recent_sources: Source[];
}

export const DEFAULT_MONTHLY_CREDITS = 10_000;

/**
 * Sentinel stored in `plans.monthly_credits` for "unlimited" tiers, since the
 * column is NOT NULL. Helpers treat values >= this as no cap.
 */
export const UNLIMITED_CREDITS_SENTINEL = 999_999_999;

/** Stripe subscription statuses that grant plan access. */
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;

export function monthlyCreditLimit(): number {
  const configured = Number.parseInt(process.env.MNEMIS_FREE_MONTHLY_CREDITS ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MONTHLY_CREDITS;
}

function freePlanFallback(): Plan {
  const now = new Date();
  return {
    id: 'free',
    name: 'Free',
    description: null,
    stripePriceId: null,
    monthlyCredits: monthlyCreditLimit(),
    includedSeats: 1,
    maxSources: null,
    maxResearchRunsPerMonth: null,
    features: {},
    active: true,
    createdAt: now,
    updatedAt: now,
  } satisfies Plan;
}

/**
 * Resolves the active plan for a workspace. Returns the plan tied to an active
 * (or trialing) subscription, otherwise the `free` row. If even `free` is
 * missing (DB unseeded), synthesises a fallback using env-based defaults so
 * production behaviour matches today's single-tier flat limit.
 */
export async function getPlanForWorkspace(db: Database, workspaceId: string): Promise<Plan> {
  const [activeRow] = await db
    .select({ plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.workspaceId, workspaceId),
        inArray(subscriptions.status, ACTIVE_SUBSCRIPTION_STATUSES as unknown as string[]),
      ),
    )
    .limit(1);
  if (activeRow?.plan) return activeRow.plan;

  const [freeRow] = await db.select().from(plans).where(eq(plans.id, 'free')).limit(1);
  return freeRow ?? freePlanFallback();
}

/**
 * Effective monthly credit limit for a workspace. Treats the UNLIMITED sentinel
 * (and any value >= it) as no cap and returns Number.MAX_SAFE_INTEGER so the
 * call site can do a simple numeric comparison.
 */
export async function getWorkspaceCreditLimit(db: Database, workspaceId: string): Promise<number> {
  const plan = await getPlanForWorkspace(db, workspaceId);
  if (plan.monthlyCredits >= UNLIMITED_CREDITS_SENTINEL) return Number.MAX_SAFE_INTEGER;
  return plan.monthlyCredits;
}

export async function getWorkspaceSourceQuota(
  db: Database,
  workspaceId: string,
): Promise<QuotaSummary> {
  const plan = await getPlanForWorkspace(db, workspaceId);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sources)
    .where(eq(sources.workspaceId, workspaceId));
  return { used: row?.count ?? 0, max: plan.maxSources };
}

export async function getWorkspaceResearchQuota(
  db: Database,
  workspaceId: string,
  now = new Date(),
): Promise<QuotaSummary> {
  const plan = await getPlanForWorkspace(db, workspaceId);
  const { start, end } = billingPeriod(now);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.workspaceId, workspaceId),
        gte(researchRuns.createdAt, start),
        lt(researchRuns.createdAt, end),
      ),
    );
  return { used: row?.count ?? 0, max: plan.maxResearchRunsPerMonth };
}

export function researchRunCreditCost(depth: 'quick' | 'standard' | 'deep'): number {
  return depth === 'deep' ? 150 : depth === 'standard' ? 60 : 20;
}

async function getWorkspaceUsedCredits(
  db: Database,
  workspaceId: string,
  now = new Date(),
): Promise<number> {
  const { start, end } = billingPeriod(now);
  const [row] = await db
    .select({ credits: sql<number>`coalesce(sum(${usageEvents.costCredits}), 0)::int` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.workspaceId, workspaceId),
        gte(usageEvents.occurredAt, start),
        lt(usageEvents.occurredAt, end),
      ),
    );
  return row?.credits ?? 0;
}

export async function assertWorkspaceCreditsAvailable(
  db: Database,
  workspaceId: string,
  costCredits: number,
  now = new Date(),
): Promise<void> {
  const plan = await getPlanForWorkspace(db, workspaceId);
  if (plan.monthlyCredits >= UNLIMITED_CREDITS_SENTINEL) return;

  const used = await getWorkspaceUsedCredits(db, workspaceId, now);
  if (used + costCredits <= plan.monthlyCredits) return;

  throw new Error(
    `Credit quota reached (${used}/${plan.monthlyCredits}). Upgrade your plan to continue.`,
  );
}

export async function recordWorkspaceUsage(input: {
  db: Database;
  workspaceId: string;
  kind: 'index' | 'research';
  costCredits: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await input.db.insert(usageEvents).values({
    workspaceId: input.workspaceId,
    kind: input.kind,
    costCredits: input.costCredits,
    metadata: input.metadata ?? {},
  });
}

export async function withWorkspaceUsageLock<T>(
  db: Database,
  workspaceId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    return fn(tx as unknown as Database);
  });
}

export const DEFAULT_KEY_SCOPES = [
  'memories:*',
  'sources:*',
  'search:*',
  'research:*',
  'admin:sweep',
] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function defaultWorkspaceSlug(identity: SaasIdentity): string {
  const base =
    identity.workspaceName ??
    identity.email.split('@')[0] ??
    identity.name ??
    `workspace-${identity.externalId.slice(-8)}`;
  return slugify(base) || `workspace-${identity.externalId.slice(-8).toLowerCase()}`;
}

async function uniqueWorkspaceSlug(db: Database, preferred: string): Promise<string> {
  const base = slugify(preferred) || 'workspace';
  for (let i = 0; i < 20; i += 1) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);
    if (!existing[0]) return slug;
  }
  return `${base}-${randomBytes(4).toString('hex')}`;
}

export function generateApiKey(secret: string | undefined): {
  raw: string;
  hash: string;
  prefix: string;
} {
  const raw = `mn_${randomBytes(24).toString('hex')}`;
  return {
    raw,
    hash: apiKeyHash(raw, secret),
    prefix: apiKeyPrefix(raw),
  };
}

export function billingPeriod(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

async function findUser(db: Database, identity: SaasIdentity): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(or(eq(users.externalId, identity.externalId), eq(users.email, identity.email)))
    .limit(1);
  return row ?? null;
}

export async function ensureSaasWorkspace(
  db: Database,
  identity: SaasIdentity,
): Promise<SaasWorkspaceContext> {
  const existingUser = await findUser(db, identity);
  const user =
    existingUser ??
    (
      await db
        .insert(users)
        .values({
          email: identity.email,
          name: identity.name ?? identity.email.split('@')[0],
          externalId: identity.externalId,
        })
        .returning()
    )[0];

  if (!user) throw new Error('failed to create SaaS user');

  if (user.externalId !== identity.externalId || (identity.name && user.name !== identity.name)) {
    const [updated] = await db
      .update(users)
      .set({
        externalId: identity.externalId,
        name: identity.name ?? user.name,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    if (updated) Object.assign(user, updated);
  }

  const externalWorkspace =
    identity.workspaceExternalId &&
    (
      await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.externalId, identity.workspaceExternalId))
        .limit(1)
    )[0];
  if (externalWorkspace) {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: externalWorkspace.id, userId: user.id, role: 'admin' })
      .onConflictDoNothing();
    return { user, workspace: externalWorkspace, role: 'admin' };
  }

  const [memberWorkspace] = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, user.id))
    .orderBy(desc(workspaceMembers.createdAt))
    .limit(1);
  if (memberWorkspace) {
    return { user, workspace: memberWorkspace.workspace, role: memberWorkspace.role };
  }

  const [ownedWorkspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerId, user.id))
    .orderBy(desc(workspaces.createdAt))
    .limit(1);
  if (ownedWorkspace) {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: ownedWorkspace.id, userId: user.id, role: 'owner' })
      .onConflictDoNothing();
    return { user, workspace: ownedWorkspace, role: 'owner' };
  }

  const slug = await uniqueWorkspaceSlug(db, defaultWorkspaceSlug(identity));
  const [workspace] = await db
    .insert(workspaces)
    .values({
      slug,
      name: identity.workspaceName ?? `${identity.name ?? identity.email}'s workspace`,
      externalId: identity.workspaceExternalId ?? null,
      ownerId: user.id,
    })
    .returning();
  if (!workspace) throw new Error('failed to create SaaS workspace');

  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  });

  return { user, workspace, role: 'owner' };
}

async function subscriptionForWorkspace(
  db: Database,
  workspaceId: string,
): Promise<Subscription | null> {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  return subscription ?? null;
}

export async function getUsageSummary(
  db: Database,
  workspaceId: string,
  now = new Date(),
): Promise<UsageSummary> {
  const { start, end } = billingPeriod(now);
  const [rows, plan] = await Promise.all([
    db
      .select({
        credits: sql<number>`coalesce(sum(${usageEvents.costCredits}), 0)::int`,
        requests: sql<number>`count(*)::int`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.workspaceId, workspaceId),
          gte(usageEvents.occurredAt, start),
          lt(usageEvents.occurredAt, end),
        ),
      ),
    getPlanForWorkspace(db, workspaceId),
  ]);
  const row = rows[0];

  const used = row?.credits ?? 0;
  const unlimited = plan.monthlyCredits >= UNLIMITED_CREDITS_SENTINEL;
  const limit = plan.monthlyCredits;
  return {
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    credits_used: used,
    credits_limit: limit,
    credits_remaining: unlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used),
    credits_unlimited: unlimited,
    requests: row?.requests ?? 0,
  };
}

export async function getDashboardSnapshot(
  db: Database,
  context: SaasWorkspaceContext,
): Promise<DashboardSnapshot> {
  const workspaceId = context.workspace.id;
  const [
    sourceCount,
    indexedSourceCount,
    failedSourceCount,
    researchCount,
    queuedJobCount,
    failedJobCount,
    memoryCount,
    chunkCount,
    apiKeysRows,
    recentSources,
    subscription,
    usage,
    plan,
    researchQuota,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sources)
      .where(eq(sources.workspaceId, workspaceId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sources)
      .where(and(eq(sources.workspaceId, workspaceId), eq(sources.status, 'indexed'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sources)
      .where(and(eq(sources.workspaceId, workspaceId), eq(sources.status, 'failed'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(researchRuns)
      .where(eq(researchRuns.workspaceId, workspaceId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, 'queued'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, 'failed'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(memories)
      .where(eq(memories.workspaceId, workspaceId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(chunks)
      .where(eq(chunks.workspaceId, workspaceId)),
    db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.workspaceId, workspaceId))
      .orderBy(desc(apiKeys.createdAt))
      .limit(12),
    db
      .select()
      .from(sources)
      .where(eq(sources.workspaceId, workspaceId))
      .orderBy(desc(sources.createdAt))
      .limit(8),
    subscriptionForWorkspace(db, workspaceId),
    getUsageSummary(db, workspaceId),
    getPlanForWorkspace(db, workspaceId),
    getWorkspaceResearchQuota(db, workspaceId),
  ]);

  return {
    ...context,
    plan,
    subscription: subscription
      ? {
          status: subscription.status,
          stripePriceId: subscription.stripePriceId,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
    usage,
    quotas: {
      sources: { used: sourceCount[0]?.count ?? 0, max: plan.maxSources },
      research_runs: researchQuota,
    },
    counts: {
      sources: sourceCount[0]?.count ?? 0,
      indexed_sources: indexedSourceCount[0]?.count ?? 0,
      failed_sources: failedSourceCount[0]?.count ?? 0,
      research_runs: researchCount[0]?.count ?? 0,
      queued_jobs: queuedJobCount[0]?.count ?? 0,
      failed_jobs: failedJobCount[0]?.count ?? 0,
      memories: memoryCount[0]?.count ?? 0,
      chunks: chunkCount[0]?.count ?? 0,
    },
    api_keys: apiKeysRows,
    recent_sources: recentSources,
  };
}

export async function createWorkspaceApiKey(input: {
  db: Database;
  workspaceId: string;
  name: string;
  scopes?: readonly string[];
  expiresAt?: Date | null;
  secret?: string;
}): Promise<{ raw: string; apiKey: ApiKey }> {
  const key = generateApiKey(input.secret);
  const [apiKey] = await input.db
    .insert(apiKeys)
    .values({
      workspaceId: input.workspaceId,
      name: input.name.trim() || 'Dashboard key',
      keyHash: key.hash,
      prefix: key.prefix,
      scopes: [...(input.scopes ?? DEFAULT_KEY_SCOPES)],
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!apiKey) throw new Error('failed to create API key');
  return { raw: key.raw, apiKey };
}

export async function revokeWorkspaceApiKey(
  db: Database,
  workspaceId: string,
  apiKeyId: string,
): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.id, apiKeyId)));
}

function normalizeUrl(identifier: string): string {
  const url = new URL(identifier.trim());
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export async function createDashboardSource(input: {
  db: Database;
  workspaceId: string;
  kind: 'docs_site' | 'web_page' | 'pdf_document';
  identifier: string;
  displayName?: string | null;
}): Promise<Source> {
  const identifier = normalizeUrl(input.identifier);
  return withWorkspaceUsageLock(input.db, input.workspaceId, async (db) => {
    const existing = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.workspaceId, input.workspaceId), eq(sources.identifier, identifier)))
      .limit(1);
    const quota = await getWorkspaceSourceQuota(db, input.workspaceId);
    if (existing[0]) throw new Error('source already exists');
    if (quota.max !== null && quota.used >= quota.max) {
      throw new Error(
        `Source quota reached (${quota.used}/${quota.max}). Upgrade your plan to add more.`,
      );
    }
    await assertWorkspaceCreditsAvailable(db, input.workspaceId, 1);

    const url = new URL(identifier);
    const [source] = await db
      .insert(sources)
      .values({
        workspaceId: input.workspaceId,
        kind: input.kind,
        identifier,
        displayName:
          input.displayName?.trim() ||
          (url.pathname && url.pathname !== '/' ? `${url.hostname}${url.pathname}` : url.hostname),
        config:
          input.kind === 'docs_site'
            ? { docsCrawler: 'auto', maxPages: 100, respectRobots: true }
            : input.kind === 'pdf_document'
              ? { pdfExtractor: 'auto' }
              : {},
        indexStrategy: 'manual',
        status: 'pending',
        statusMessage: 'Index job queued',
      })
      .returning();
    if (!source) throw new Error('failed to create source');

    await db.insert(jobs).values({
      workspaceId: input.workspaceId,
      kind: 'index_source',
      payload: {
        source_id: source.id,
        source_kind: source.kind,
        identifier: source.identifier,
        config: source.config,
      },
      progress: { done: 0, total: null, current: null },
    });
    await recordWorkspaceUsage({
      db,
      workspaceId: input.workspaceId,
      kind: 'index',
      costCredits: 1,
      metadata: { source_id: source.id, source_kind: source.kind },
    });

    return source;
  });
}

export async function createDashboardResearchRun(input: {
  db: Database;
  workspaceId: string;
  query: string;
  depth?: 'quick' | 'standard' | 'deep';
}): Promise<string> {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');
  const depth = input.depth ?? 'standard';
  const costCredits = researchRunCreditCost(depth);
  return withWorkspaceUsageLock(input.db, input.workspaceId, async (db) => {
    const quota = await getWorkspaceResearchQuota(db, input.workspaceId);
    if (quota.max !== null && quota.used >= quota.max) {
      throw new Error(
        `Research run quota reached (${quota.used}/${quota.max} this month). Upgrade your plan to run more.`,
      );
    }
    await assertWorkspaceCreditsAvailable(db, input.workspaceId, costCredits);
    const config = {
      depth,
      maxSources: depth === 'deep' ? 20 : 8,
      includeWeb: true,
      includePapers: true,
      includePdfs: true,
      index: true,
      urls: [],
    };

    const [run] = await db
      .insert(researchRuns)
      .values({
        workspaceId: input.workspaceId,
        query,
        depth: config.depth,
        status: 'queued',
        config,
      })
      .returning({ id: researchRuns.id });
    if (!run) throw new Error('failed to create research run');

    await db.insert(jobs).values({
      workspaceId: input.workspaceId,
      kind: 'research_run',
      payload: {
        research_run_id: run.id,
        query,
        config,
      },
      progress: { done: 0, total: null, current: null },
    });
    await recordWorkspaceUsage({
      db,
      workspaceId: input.workspaceId,
      kind: 'research',
      costCredits,
      metadata: { research_run_id: run.id, depth },
    });

    return run.id;
  });
}
