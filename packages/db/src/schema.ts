import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/**
 * Custom type for Postgres tsvector. Drizzle does not ship a first-class type
 * for it, so we map it as opaque text at the TS layer and rely on triggers /
 * generated columns in Postgres to populate it.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

const VECTOR_DIM = 1024;

/* ----------------------------------------------------------------------------
 *  users
 * --------------------------------------------------------------------------*/
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
    externalIdIdx: uniqueIndex('users_external_id_idx').on(t.externalId),
  }),
);

/* ----------------------------------------------------------------------------
 *  workspaces
 * --------------------------------------------------------------------------*/
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    externalId: text('external_id'),
    ownerId: uuid('owner_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex('workspaces_slug_idx').on(t.slug),
    externalIdIdx: uniqueIndex('workspaces_external_id_idx').on(t.externalId),
    ownerIdx: index('workspaces_owner_idx').on(t.ownerId),
  }),
);

/* ----------------------------------------------------------------------------
 *  SaaS billing
 * --------------------------------------------------------------------------*/
export const plans = pgTable(
  'plans',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    stripePriceId: text('stripe_price_id'),
    monthlyCredits: integer('monthly_credits').notNull(),
    includedSeats: integer('included_seats').notNull().default(1),
    maxSources: integer('max_sources'),
    maxResearchRunsPerMonth: integer('max_research_runs_per_month'),
    features: jsonb('features').notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    stripePriceIdx: uniqueIndex('plans_stripe_price_idx').on(t.stripePriceId),
  }),
);

export const billingCustomers = pgTable(
  'billing_customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    billingEmail: text('billing_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceIdx: uniqueIndex('billing_customers_workspace_idx').on(t.workspaceId),
    stripeCustomerIdx: uniqueIndex('billing_customers_stripe_customer_idx').on(t.stripeCustomerId),
  }),
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    planId: text('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    stripeSubscriptionId: text('stripe_subscription_id').notNull(),
    stripePriceId: text('stripe_price_id').notNull(),
    status: text('status').notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    trialEnd: timestamp('trial_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceIdx: uniqueIndex('subscriptions_workspace_idx').on(t.workspaceId),
    stripeSubscriptionIdx: uniqueIndex('subscriptions_stripe_subscription_idx').on(
      t.stripeSubscriptionId,
    ),
    statusIdx: index('subscriptions_status_idx').on(t.status),
  }),
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull(), // owner | admin | member
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.userId] }),
  }),
);

/* ----------------------------------------------------------------------------
 *  github_app_installations — GitHub App installs linked to workspaces
 * --------------------------------------------------------------------------*/
export const githubAppInstallations = pgTable(
  'github_app_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    installationId: text('installation_id').notNull(),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type'),
    repositorySelection: text('repository_selection'),
    permissions: jsonb('permissions').notNull().default({}),
    events: text('events').array().notNull().default(sql`'{}'::text[]`),
    installedAt: timestamp('installed_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    installationIdx: uniqueIndex('github_app_installations_installation_idx').on(t.installationId),
    workspaceIdx: index('github_app_installations_workspace_idx').on(t.workspaceId),
    accountIdx: index('github_app_installations_account_idx').on(t.accountLogin),
  }),
);

/* ----------------------------------------------------------------------------
 *  api_keys
 * --------------------------------------------------------------------------*/
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(), // first 11 chars, shown in UI
    keyHash: text('key_hash').notNull(), // hmac_sha256(key) for new keys; legacy sha256 is still accepted
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    workspaceIdx: index('api_keys_workspace_idx').on(t.workspaceId),
    hashIdx: uniqueIndex('api_keys_hash_idx').on(t.keyHash),
    prefixIdx: index('api_keys_prefix_idx').on(t.prefix),
  }),
);

/* ----------------------------------------------------------------------------
 *  sources — indexed knowledge sources (repos, docs, web pages, PDFs, papers)
 * --------------------------------------------------------------------------*/
export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    kind: text('kind').notNull(), // github_repo | docs_site | web_page | pdf_document | academic_paper
    identifier: text('identifier').notNull(), // owner/repo, full URL, DOI/arXiv URL, or collection id
    displayName: text('display_name').notNull(),
    config: jsonb('config').notNull().default({}), // branch, includes, excludes, focus_instructions
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
    lastChangeAt: timestamp('last_change_at', { withTimezone: true }),
    indexStrategy: text('index_strategy').notNull().default('manual'), // manual | webhook | cron
    cronSchedule: text('cron_schedule'),
    status: text('status').notNull().default('pending'), // pending | indexing | indexed | failed
    statusMessage: text('status_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceIdx: index('sources_workspace_idx').on(t.workspaceId),
    workspaceIdentifierIdx: uniqueIndex('sources_workspace_identifier_idx').on(
      t.workspaceId,
      t.identifier,
    ),
  }),
);

/* ----------------------------------------------------------------------------
 *  research_runs — autonomous discovery + indexing workflows
 * --------------------------------------------------------------------------*/
export const researchRuns = pgTable(
  'research_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    query: text('query').notNull(),
    depth: text('depth').notNull().default('standard'), // quick | standard | deep
    status: text('status').notNull().default('queued'), // queued | processing | completed | failed
    config: jsonb('config').notNull().default({}),
    result: jsonb('result'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    workspaceIdx: index('research_runs_workspace_idx').on(t.workspaceId),
    workspaceStatusIdx: index('research_runs_workspace_status_idx').on(t.workspaceId, t.status),
    workspaceCreatedIdx: index('research_runs_workspace_created_idx').on(
      t.workspaceId,
      t.createdAt,
    ),
  }),
);

export const researchRunSources = pgTable(
  'research_run_sources',
  {
    researchRunId: uuid('research_run_id')
      .references(() => researchRuns.id, { onDelete: 'cascade' })
      .notNull(),
    sourceId: uuid('source_id')
      .references(() => sources.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    rank: integer('rank').notNull(),
    status: text('status').notNull().default('pending'), // pending | indexed | failed | skipped
    candidate: jsonb('candidate').notNull().default({}),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.researchRunId, t.sourceId] }),
    workspaceIdx: index('research_run_sources_workspace_idx').on(t.workspaceId),
    sourceIdx: index('research_run_sources_source_idx').on(t.sourceId),
  }),
);

/* ----------------------------------------------------------------------------
 *  chunks — atomic units of retrieval
 *
 *  Supports parent-child chunking (cAST, 2026): a parent chunk represents a
 *  larger logical unit (a full function, class, or section) while child chunks
 *  capture finer-grained pieces. Search matches children; the API returns the
 *  parent for the model. parent_id is a self-FK and is NULL for root chunks.
 * --------------------------------------------------------------------------*/
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .references(() => sources.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => chunks.id, { onDelete: 'cascade' }),

    // location
    path: text('path').notNull(),
    lineStart: integer('line_start').notNull(),
    lineEnd: integer('line_end').notNull(),
    page: integer('page'), // for PDFs (post-MVP)
    sectionPath: text('section_path').array().notNull().default(sql`'{}'::text[]`),

    // content
    rawText: text('raw_text').notNull(),
    contextualPrefix: text('contextual_prefix'), // Anthropic Contextual Retrieval
    language: text('language'),

    // retrieval infra
    embedding: vector('embedding', { dimensions: VECTOR_DIM }),
    bodyTsv: tsvector('body_tsv'),

    metadata: jsonb('metadata').notNull().default({}),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sourceIdx: index('chunks_source_idx').on(t.sourceId),
    workspaceIdx: index('chunks_workspace_idx').on(t.workspaceId),
    parentIdx: index('chunks_parent_idx').on(t.parentId),
    // Idempotent reindex: upsert by (source, path, line range)
    sourceLocationIdx: uniqueIndex('chunks_source_location_idx').on(
      t.sourceId,
      t.path,
      t.lineStart,
      t.lineEnd,
    ),
    embeddingIdx: index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    bodyTsvIdx: index('chunks_body_tsv_idx').using('gin', t.bodyTsv),
  }),
);

/* ----------------------------------------------------------------------------
 *  memories — persistent + cross-agent memory
 *
 *  Inspired by Mem0 v3 (ADD-only) and Nia (memory_type + TTL + lineage). The
 *  agent never UPDATEs an existing memory destructively; new facts get added
 *  and retrieval ranks by relevance + recency.
 * --------------------------------------------------------------------------*/
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    agentOrigin: text('agent_origin'), // cursor | claude-code | codex | custom

    // classification
    kind: text('kind').notNull(), // working | session | fact | procedural
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    body: text('body').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),

    // scoping
    directory: text('directory'),
    fileOverlap: text('file_overlap').array().notNull().default(sql`'{}'::text[]`),

    // lifecycle
    ttlSeconds: integer('ttl_seconds'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    // provenance / lineage
    sourceIds: uuid('source_ids').array().notNull().default(sql`'{}'::uuid[]`),
    derivedFrom: uuid('derived_from').references((): AnyPgColumn => memories.id, {
      onDelete: 'set null',
    }),
    confidence: real('confidence'), // 0..1
    toolCalls: jsonb('tool_calls').notNull().default([]),
    modelVersion: text('model_version'),

    // optional snapshot of edits made during this context
    editedFiles: jsonb('edited_files').notNull().default([]),

    // free metadata
    metadata: jsonb('metadata').notNull().default({}),

    // retrieval infra
    embedding: vector('embedding', { dimensions: VECTOR_DIM }),
    bodyTsv: tsvector('body_tsv'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceKindIdx: index('memories_workspace_kind_idx').on(t.workspaceId, t.kind),
    workspaceIdx: index('memories_workspace_idx').on(t.workspaceId),
    expiresIdx: index('memories_expires_idx').on(t.expiresAt),
    archivedIdx: index('memories_archived_idx').on(t.archivedAt),
    directoryIdx: index('memories_directory_idx').on(t.directory),
    embeddingIdx: index('memories_embedding_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
    bodyTsvIdx: index('memories_body_tsv_idx').using('gin', t.bodyTsv),
  }),
);

/* ----------------------------------------------------------------------------
 *  jobs — async work (indexing, embedding, reranking)
 * --------------------------------------------------------------------------*/
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // index_source | reindex_source | embed_chunks | rerank_warmup
    status: text('status').notNull().default('queued'), // queued | processing | completed | failed
    payload: jsonb('payload').notNull().default({}),
    progress: jsonb('progress').notNull().default({}),
    result: jsonb('result'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    statusScheduledIdx: index('jobs_status_scheduled_idx').on(t.status, t.scheduledAt),
    workspaceIdx: index('jobs_workspace_idx').on(t.workspaceId),
  }),
);

/* ----------------------------------------------------------------------------
 *  usage_events — telemetry for billing + rate limits
 * --------------------------------------------------------------------------*/
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(), // search | save | index | rerank | synthesize
    costCredits: integer('cost_credits').notNull().default(1),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceOccurredIdx: index('usage_events_workspace_occurred_idx').on(
      t.workspaceId,
      t.occurredAt,
    ),
    apiKeyOccurredIdx: index('usage_events_api_key_occurred_idx').on(t.apiKeyId, t.occurredAt),
    kindIdx: index('usage_events_kind_idx').on(t.kind),
  }),
);

/* ----------------------------------------------------------------------------
 *  Relations
 * --------------------------------------------------------------------------*/
export const usersRelations = relations(users, ({ many }) => ({
  ownedWorkspaces: many(workspaces),
  memberships: many(workspaceMembers),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, { fields: [workspaces.ownerId], references: [users.id] }),
  members: many(workspaceMembers),
  billingCustomer: one(billingCustomers, {
    fields: [workspaces.id],
    references: [billingCustomers.workspaceId],
  }),
  subscription: one(subscriptions, {
    fields: [workspaces.id],
    references: [subscriptions.workspaceId],
  }),
  githubAppInstallations: many(githubAppInstallations),
  apiKeys: many(apiKeys),
  sources: many(sources),
  researchRuns: many(researchRuns),
  memories: many(memories),
}));

export const billingCustomersRelations = relations(billingCustomers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [billingCustomers.workspaceId],
    references: [workspaces.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [subscriptions.workspaceId],
    references: [workspaces.id],
  }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
}));

export const githubAppInstallationsRelations = relations(githubAppInstallations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [githubAppInstallations.workspaceId],
    references: [workspaces.id],
  }),
}));

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [sources.workspaceId], references: [workspaces.id] }),
  chunks: many(chunks),
  researchRunSources: many(researchRunSources),
}));

export const researchRunsRelations = relations(researchRuns, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [researchRuns.workspaceId], references: [workspaces.id] }),
  sources: many(researchRunSources),
}));

export const researchRunSourcesRelations = relations(researchRunSources, ({ one }) => ({
  researchRun: one(researchRuns, {
    fields: [researchRunSources.researchRunId],
    references: [researchRuns.id],
  }),
  source: one(sources, { fields: [researchRunSources.sourceId], references: [sources.id] }),
  workspace: one(workspaces, {
    fields: [researchRunSources.workspaceId],
    references: [workspaces.id],
  }),
}));

export const chunksRelations = relations(chunks, ({ one, many }) => ({
  source: one(sources, { fields: [chunks.sourceId], references: [sources.id] }),
  workspace: one(workspaces, { fields: [chunks.workspaceId], references: [workspaces.id] }),
  parent: one(chunks, {
    fields: [chunks.parentId],
    references: [chunks.id],
    relationName: 'children',
  }),
  children: many(chunks, { relationName: 'children' }),
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
  workspace: one(workspaces, { fields: [memories.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [memories.userId], references: [users.id] }),
  parent: one(memories, { fields: [memories.derivedFrom], references: [memories.id] }),
}));

/* ----------------------------------------------------------------------------
 *  Type exports for downstream packages
 * --------------------------------------------------------------------------*/
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type GitHubAppInstallation = typeof githubAppInstallations.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type ResearchRun = typeof researchRuns.$inferSelect;
export type ResearchRunSource = typeof researchRunSources.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;

export type MemoryKind = 'working' | 'session' | 'fact' | 'procedural';
export type SourceKind =
  | 'github_repo'
  | 'docs_site'
  | 'web_page'
  | 'pdf_document'
  | 'academic_paper'
  | 'research_collection';
export type SourceStatus = 'pending' | 'indexing' | 'indexed' | 'failed';
export type ResearchRunStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
