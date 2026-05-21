import type {
  ChunkSearchResponse,
  GitHubInstallationDto,
  JobDto,
  MemoryDto,
  MemoryListResponse,
  MemorySearchResponse,
  MnemisClient,
  ResearchRunDto,
  ResearchRunListResponse,
  SourceDto,
  SourceListResponse,
  SourceStatusDto,
} from '@mnemis/sdk';
import { z } from 'zod';

export interface ToolContext {
  client: MnemisClient;
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function jsonText(value: unknown): ToolResult {
  return text(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(4);
}

function renderMemoryList(response: MemoryListResponse, includeBody = false): string {
  if (response.items.length === 0) return '_No memories found._';
  const lines: string[] = [`# Memories (${response.items.length} of ${response.total})`, ''];
  for (const m of response.items) {
    lines.push(`## ${m.title}`);
    const meta = [
      `kind: \`${m.kind}\``,
      m.directory ? `dir: \`${m.directory}\`` : null,
      m.tags && m.tags.length > 0 ? `tags: ${m.tags.map((t) => `\`${t}\``).join(', ')}` : null,
      `created: ${m.created_at}`,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`_${meta}_`);
    lines.push('');
    lines.push(m.summary);
    if (includeBody && m.body) {
      lines.push('');
      lines.push('```');
      lines.push(m.body);
      lines.push('```');
    }
    lines.push('');
    lines.push(`_id: \`${m.id}\`_`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderMemorySearch(response: MemorySearchResponse, includeBody = false): string {
  if (response.items.length === 0) return '_No memories found._';
  const meta = [
    `mode: \`${response.mode}\``,
    response.reranked ? `reranked: \`${response.reranker_model ?? 'unknown'}\`` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const lines: string[] = [`# Memory Search (${response.items.length} of ${response.count})`, ''];
  if (meta) {
    lines.push(`_${meta}_`);
    lines.push('');
  }
  for (const hit of response.items) {
    const m = hit.memory;
    const ranks = [
      hit.ranks.bm25 ? `text #${hit.ranks.bm25}` : null,
      hit.ranks.vector ? `vector #${hit.ranks.vector}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(`## ${m.title}`);
    lines.push(
      `_kind: \`${m.kind}\` · score: ${formatScore(hit.score)}${ranks ? ` · ${ranks}` : ''}_`,
    );
    lines.push('');
    lines.push(m.summary);
    if (includeBody && m.body) {
      lines.push('');
      lines.push('```');
      lines.push(m.body);
      lines.push('```');
    }
    lines.push('');
    lines.push(`_id: \`${m.id}\`_`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderSourceList(response: SourceListResponse): string {
  if (response.items.length === 0) return '_No sources registered._';
  const lines: string[] = [`# Sources (${response.items.length} of ${response.total})`, ''];
  for (const s of response.items) {
    lines.push(`## ${s.display_name} — \`${s.kind}\``);
    const meta = [
      `id: \`${s.id}\``,
      `identifier: \`${s.identifier}\``,
      `status: ${s.status}`,
      s.last_indexed_at ? `last indexed: ${s.last_indexed_at}` : 'never indexed',
      `strategy: ${s.index_strategy}${s.cron_schedule ? ` (${s.cron_schedule})` : ''}`,
    ].join(' · ');
    lines.push(`_${meta}_`);
    if (s.status_message) lines.push(`> ${s.status_message}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderSourceStatus(status: SourceStatusDto): string {
  const source = status.source;
  const lines: string[] = [];
  lines.push(`## ${source.display_name} — \`${source.kind}\``);
  lines.push(`_id: \`${source.id}\` · identifier: \`${source.identifier}\`_`);
  lines.push('');
  lines.push(
    `status: ${source.status}${source.status_message ? ` — ${source.status_message}` : ''}`,
  );
  lines.push(`chunks: ${status.chunk_count}`);
  lines.push(`last indexed: ${source.last_indexed_at ?? 'never'}`);
  if (status.latest_job) {
    lines.push('');
    lines.push(renderJob(status.latest_job));
  }
  return lines.join('\n');
}

function renderResearchRun(run: ResearchRunDto): string {
  const lines: string[] = [];
  lines.push(`## ${run.query} — \`${run.status}\``);
  lines.push(`_id: \`${run.id}\` · depth: \`${run.depth}\` · created: ${run.created_at}_`);
  if (run.completed_at) lines.push(`_completed: ${run.completed_at}_`);
  if (run.error) lines.push(`> ${run.error}`);
  if (run.result) {
    const indexed = run.result.indexed_sources;
    const failed = run.result.failed_sources;
    const details = [
      typeof indexed === 'number' ? `indexed: ${indexed}` : null,
      typeof failed === 'number' ? `failed: ${failed}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (details) lines.push(details);
  }
  return lines.join('\n');
}

function renderResearchRunList(response: ResearchRunListResponse): string {
  if (response.items.length === 0) return '_No research runs found._';
  const lines: string[] = [`# Research runs (${response.items.length} of ${response.total})`, ''];
  for (const run of response.items) {
    lines.push(renderResearchRun(run), '');
  }
  return lines.join('\n').trimEnd();
}

function renderJob(job: JobDto): string {
  return `job: \`${job.id}\` · kind: ${job.kind} · status: ${job.status}`;
}

function renderGithubInstallations(items: GitHubInstallationDto[]): string {
  if (items.length === 0) return '_No GitHub installations registered._';
  const lines: string[] = [`# GitHub installations (${items.length})`, ''];
  for (const installation of items) {
    lines.push(`## ${installation.account_login}`);
    const meta = [
      `installation: \`${installation.installation_id}\``,
      `id: \`${installation.id}\``,
      installation.account_type ? `type: ${installation.account_type}` : null,
      installation.repository_selection ? `repos: ${installation.repository_selection}` : null,
      installation.events.length > 0 ? `events: ${installation.events.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`_${meta}_`);
    if (installation.suspended_at) lines.push(`_suspended: ${installation.suspended_at}_`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderSearchResponse(response: ChunkSearchResponse): ToolResult {
  if (response.mode === 'markdown' && response.markdown) {
    return text(response.markdown);
  }
  if (response.mode === 'synthesized' && response.answer) {
    return text(
      `${response.answer}\n\n_model: ${response.synthesis_model ?? 'unknown'} · retrieval: ${response.retrieval}_`,
    );
  }
  return jsonText(response);
}

/* -------------------------------------------------------------------------- */
/*  source_search                                                              */
/* -------------------------------------------------------------------------- */

export const sourceSearchInput = {
  query: z.string().min(1).max(1_000).describe('Natural language query'),
  mode: z
    .enum(['markdown', 'raw', 'synthesized'])
    .optional()
    .default('markdown')
    .describe(
      'Response format. markdown = rendered with citations, raw = JSON chunks, synthesized = LLM answer with citations',
    ),
  limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
  sourceIds: z
    .array(z.string().uuid())
    .max(100)
    .optional()
    .describe('Restrict to these source UUIDs'),
  kinds: z
    .array(
      z.enum([
        'github_repo',
        'docs_site',
        'web_page',
        'pdf_document',
        'academic_paper',
        'research_collection',
      ]),
    )
    .max(6)
    .optional()
    .describe('Restrict to these source kinds'),
  pathPrefix: z
    .string()
    .min(1)
    .max(1_000)
    .optional()
    .describe('Restrict to paths under this prefix'),
};

export async function sourceSearch(
  ctx: ToolContext,
  input: {
    query: string;
    mode: 'markdown' | 'raw' | 'synthesized';
    limit?: number;
    sourceIds?: string[];
    kinds?: Array<
      | 'github_repo'
      | 'docs_site'
      | 'web_page'
      | 'pdf_document'
      | 'academic_paper'
      | 'research_collection'
    >;
    pathPrefix?: string;
  },
): Promise<ToolResult> {
  const response = await ctx.client.search({
    query: input.query,
    mode: input.mode,
    limit: input.limit,
    sourceIds: input.sourceIds,
    kinds: input.kinds,
    pathPrefix: input.pathPrefix,
  });
  return renderSearchResponse(response);
}

/* -------------------------------------------------------------------------- */
/*  source_index                                                               */
/* -------------------------------------------------------------------------- */

export const sourceIndexInput = {
  kind: z
    .enum([
      'github_repo',
      'docs_site',
      'web_page',
      'pdf_document',
      'academic_paper',
      'research_collection',
    ])
    .describe('Source type'),
  identifier: z
    .string()
    .min(1)
    .max(2_000)
    .describe('owner/repo for github_repo, URL for web/docs/PDF/paper sources'),
  displayName: z.string().min(1).max(255).optional().describe('Human-readable name'),
  branch: z.string().min(1).max(255).optional().describe('Git branch (github_repo only)'),
  githubInstallationId: z
    .string()
    .optional()
    .describe('GitHub App installation id for private repos'),
  indexStrategy: z
    .enum(['manual', 'webhook', 'cron'])
    .optional()
    .describe('How reindex is triggered'),
  cronSchedule: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe('Required when indexStrategy is cron; standard 5-field cron expression'),
  docsCrawler: z
    .enum(['auto', 'native', 'firecrawl'])
    .optional()
    .describe('Docs crawler provider for docs_site sources'),
  pdfExtractor: z
    .enum(['auto', 'native', 'sidecar'])
    .optional()
    .describe('PDF extractor for pdf_document or academic_paper sources'),
};

export async function sourceIndex(
  ctx: ToolContext,
  input: {
    kind:
      | 'github_repo'
      | 'docs_site'
      | 'web_page'
      | 'pdf_document'
      | 'academic_paper'
      | 'research_collection';
    identifier: string;
    displayName?: string;
    branch?: string;
    githubInstallationId?: string;
    indexStrategy?: 'manual' | 'webhook' | 'cron';
    cronSchedule?: string;
    docsCrawler?: 'auto' | 'native' | 'firecrawl';
    pdfExtractor?: 'auto' | 'native' | 'sidecar';
  },
): Promise<ToolResult> {
  const config: {
    branch?: string;
    githubInstallationId?: string;
    docsCrawler?: 'auto' | 'native' | 'firecrawl';
    pdfExtractor?: 'auto' | 'native' | 'sidecar';
  } = {};
  if (input.branch) config.branch = input.branch;
  if (input.githubInstallationId) config.githubInstallationId = input.githubInstallationId;
  if (input.docsCrawler) config.docsCrawler = input.docsCrawler;
  if (input.pdfExtractor) config.pdfExtractor = input.pdfExtractor;

  const response = await ctx.client.sources.create({
    kind: input.kind,
    identifier: input.identifier,
    displayName: input.displayName,
    config: Object.keys(config).length > 0 ? config : undefined,
    indexStrategy: input.indexStrategy ?? 'manual',
    cronSchedule: input.cronSchedule,
    enqueue: true,
  });

  const lines: string[] = [];
  lines.push(`Registered source \`${response.data.identifier}\` (kind: ${response.data.kind})`);
  lines.push(`id: \`${response.data.id}\``);
  lines.push(
    `status: ${response.data.status}${response.data.status_message ? ` — ${response.data.status_message}` : ''}`,
  );
  if (response.job) {
    lines.push(`indexing job: \`${response.job.id}\` (${response.job.status})`);
  }
  return text(lines.join('\n'));
}

/* -------------------------------------------------------------------------- */
/*  source_list                                                                */
/* -------------------------------------------------------------------------- */

export const sourceListInput = {
  kind: z
    .enum([
      'github_repo',
      'docs_site',
      'web_page',
      'pdf_document',
      'academic_paper',
      'research_collection',
    ])
    .optional()
    .describe('Filter by source kind'),
  status: z
    .enum(['pending', 'indexing', 'indexed', 'failed'])
    .optional()
    .describe('Filter by status'),
  q: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe('Substring match on identifier or display name'),
  limit: z.number().int().min(1).max(100).optional().describe('Page size (default 20)'),
};

export async function sourceList(
  ctx: ToolContext,
  input: {
    kind?:
      | 'github_repo'
      | 'docs_site'
      | 'web_page'
      | 'pdf_document'
      | 'academic_paper'
      | 'research_collection';
    status?: 'pending' | 'indexing' | 'indexed' | 'failed';
    q?: string;
    limit?: number;
  },
): Promise<ToolResult> {
  const response = await ctx.client.sources.list(input);
  return text(renderSourceList(response));
}

export const sourceGetInput = {
  id: z.string().uuid().describe('Source UUID'),
};

export async function sourceGet(ctx: ToolContext, input: { id: string }): Promise<ToolResult> {
  const response = await ctx.client.sources.get(input.id);
  return jsonText(response.data);
}

export const sourceStatusInput = {
  id: z.string().uuid().describe('Source UUID'),
};

export async function sourceStatus(ctx: ToolContext, input: { id: string }): Promise<ToolResult> {
  const status = await ctx.client.sources.status(input.id);
  return text(renderSourceStatus(status));
}

export const sourceReindexInput = {
  id: z.string().uuid().describe('Source UUID'),
};

export async function sourceReindex(ctx: ToolContext, input: { id: string }): Promise<ToolResult> {
  const response = await ctx.client.sources.reindex(input.id);
  return text(`Queued ${renderJob(response.job)}`);
}

/* -------------------------------------------------------------------------- */
/*  mnemis_research                                                            */
/* -------------------------------------------------------------------------- */

export const researchInput = {
  query: z.string().min(1).max(2_000).describe('Research question or topic'),
  depth: z.enum(['quick', 'standard', 'deep']).optional().default('standard'),
  maxSources: z.number().int().min(1).max(50).optional().describe('Max sources to index'),
  urls: z
    .array(z.string().url())
    .max(50)
    .optional()
    .describe('Seed URLs to force into the research run'),
  includeWeb: z.boolean().optional().default(true).describe('Use web search providers'),
  includePapers: z.boolean().optional().default(true).describe('Use academic paper providers'),
  includePdfs: z.boolean().optional().default(true).describe('Allow PDF sources'),
  index: z.boolean().optional().default(true).describe('Index discovered sources'),
};

export async function research(
  ctx: ToolContext,
  input: {
    query: string;
    depth?: 'quick' | 'standard' | 'deep';
    maxSources?: number;
    urls?: string[];
    includeWeb?: boolean;
    includePapers?: boolean;
    includePdfs?: boolean;
    index?: boolean;
  },
): Promise<ToolResult> {
  const response = await ctx.client.research.create(input);
  return text(
    [
      `Queued research run \`${response.data.id}\` (${response.data.status})`,
      `job: \`${response.job.id}\` (${response.job.status})`,
      '',
      renderResearchRun(response.data),
    ].join('\n'),
  );
}

export const researchStatusInput = {
  id: z.string().uuid().describe('Research run UUID'),
};

export async function researchStatus(ctx: ToolContext, input: { id: string }): Promise<ToolResult> {
  const response = await ctx.client.research.get(input.id);
  return text(renderResearchRun(response.data));
}

export const researchListInput = {
  status: z.enum(['queued', 'processing', 'completed', 'failed']).optional(),
  q: z.string().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

export async function researchList(
  ctx: ToolContext,
  input: {
    status?: 'queued' | 'processing' | 'completed' | 'failed';
    q?: string;
    limit?: number;
  },
): Promise<ToolResult> {
  const response = await ctx.client.research.list(input);
  return text(renderResearchRunList(response));
}

/* -------------------------------------------------------------------------- */
/*  memory_save                                                                */
/* -------------------------------------------------------------------------- */

export const memorySaveInput = {
  kind: z.enum(['working', 'session', 'fact', 'procedural']).describe('Memory lifetime category'),
  title: z.string().min(1).max(500).describe('Short label'),
  summary: z.string().min(1).max(2_000).describe('1-3 sentence synopsis'),
  body: z.string().min(1).max(200_000).describe('Full content (markdown ok)'),
  tags: z.array(z.string().min(1).max(64)).max(64).optional(),
  directory: z.string().max(1024).optional().describe('Project directory the memory belongs to'),
  agentOrigin: z.string().max(64).optional().describe('Which client created this memory'),
  ttlSeconds: z.number().int().nonnegative().nullable().optional().describe('Override default TTL'),
  sourceIds: z.array(z.string().uuid()).max(64).optional(),
};

export async function memorySave(
  ctx: ToolContext,
  input: {
    kind: 'working' | 'session' | 'fact' | 'procedural';
    title: string;
    summary: string;
    body: string;
    tags?: string[];
    directory?: string;
    agentOrigin?: string;
    ttlSeconds?: number | null;
    sourceIds?: string[];
  },
): Promise<ToolResult> {
  const m: MemoryDto = await ctx.client.memories.create(input);
  return text(
    `Saved memory \`${m.id}\` (kind: ${m.kind})\n` +
      `expires: ${m.expires_at ?? 'never'}\n\n` +
      `**${m.title}**\n\n${m.summary}`,
  );
}

/* -------------------------------------------------------------------------- */
/*  memory_search                                                              */
/* -------------------------------------------------------------------------- */

export const memorySearchInput = {
  query: z.string().min(1).max(1_000).describe('Search query'),
  kind: z
    .enum(['working', 'session', 'fact', 'procedural'])
    .optional()
    .describe('Restrict to one kind'),
  tags: z
    .array(z.string())
    .max(32)
    .optional()
    .describe('Restrict to memories with any of these tags'),
  directory: z.string().optional().describe('Restrict to a directory'),
  limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
  semantic: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Use hybrid semantic + Postgres full-text search when true (default), keyword-only when false',
    ),
};

export async function memorySearch(
  ctx: ToolContext,
  input: {
    query: string;
    kind?: 'working' | 'session' | 'fact' | 'procedural';
    tags?: string[];
    directory?: string;
    limit?: number;
    semantic: boolean;
  },
): Promise<ToolResult> {
  const fn = input.semantic ? ctx.client.memories.semanticSearch : ctx.client.memories.search;
  const response = await fn.call(ctx.client.memories, {
    query: input.query,
    kind: input.kind,
    tags: input.tags,
    directory: input.directory,
    limit: input.limit,
  });
  return text(renderMemorySearch(response, false));
}

/* -------------------------------------------------------------------------- */
/*  memory_list                                                                */
/* -------------------------------------------------------------------------- */

export const memoryListInput = {
  kind: z
    .enum(['working', 'session', 'fact', 'procedural'])
    .optional()
    .describe('Restrict to one kind'),
  tag: z.string().min(1).max(64).optional().describe('Restrict to one tag'),
  directory: z.string().min(1).optional().describe('Restrict to a directory'),
  q: z.string().min(1).max(500).optional().describe('Substring search over memory metadata'),
  includeArchived: z.boolean().optional().default(false),
  includeExpired: z.boolean().optional().default(false),
  includeLineage: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().describe('Page size (default 20)'),
  offset: z.number().int().min(0).optional().describe('Page offset'),
};

export async function memoryList(
  ctx: ToolContext,
  input: {
    kind?: 'working' | 'session' | 'fact' | 'procedural';
    tag?: string;
    directory?: string;
    q?: string;
    includeArchived?: boolean;
    includeExpired?: boolean;
    includeLineage?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<ToolResult> {
  const response = await ctx.client.memories.list({
    kind: input.kind,
    tag: input.tag,
    directory: input.directory,
    q: input.q,
    includeArchived: input.includeArchived,
    includeExpired: input.includeExpired,
    include: input.includeLineage ? ['lineage'] : undefined,
    limit: input.limit,
    offset: input.offset,
  });
  return text(renderMemoryList(response, false));
}

/* -------------------------------------------------------------------------- */
/*  memory_retrieve                                                            */
/* -------------------------------------------------------------------------- */

export const memoryRetrieveInput = {
  id: z.string().uuid().describe('Memory UUID'),
  includeLineage: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include source_ids, confidence, derivedFrom, toolCalls'),
};

export async function memoryRetrieve(
  ctx: ToolContext,
  input: { id: string; includeLineage: boolean },
): Promise<ToolResult> {
  const m = await ctx.client.memories.get(
    input.id,
    input.includeLineage ? { include: 'lineage' } : undefined,
  );
  return text(renderMemoryList({ items: [m], total: 1, has_more: false }, true));
}

/* -------------------------------------------------------------------------- */
/*  memory_update / memory_delete                                              */
/* -------------------------------------------------------------------------- */

export const memoryUpdateInput = {
  id: z.string().uuid().describe('Memory UUID'),
  kind: z.enum(['working', 'session', 'fact', 'procedural']).optional(),
  tags: z.array(z.string().min(1).max(64)).max(64).optional(),
  ttlSeconds: z.number().int().nonnegative().nullable().optional(),
  archived: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
};

export async function memoryUpdate(
  ctx: ToolContext,
  input: {
    id: string;
    kind?: 'working' | 'session' | 'fact' | 'procedural';
    tags?: string[];
    ttlSeconds?: number | null;
    archived?: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<ToolResult> {
  const { id, ...patch } = input;
  const m = await ctx.client.memories.patch(id, patch);
  return text(renderMemoryList({ items: [m], total: 1, has_more: false }, true));
}

export const memoryDeleteInput = {
  id: z.string().uuid().describe('Memory UUID'),
  permanent: z.boolean().optional().default(false).describe('Hard-delete instead of soft archive'),
};

export async function memoryDelete(
  ctx: ToolContext,
  input: { id: string; permanent?: boolean },
): Promise<ToolResult> {
  await ctx.client.memories.remove(input.id, { permanent: input.permanent });
  return text(input.permanent ? `Permanently deleted \`${input.id}\`` : `Deleted \`${input.id}\``);
}

/* -------------------------------------------------------------------------- */
/*  github installations                                                       */
/* -------------------------------------------------------------------------- */

export const githubInstallationListInput = {};

export async function githubInstallationList(ctx: ToolContext): Promise<ToolResult> {
  const response = await ctx.client.github.listInstallations();
  return text(renderGithubInstallations(response.items));
}

export const githubInstallationRegisterInput = {
  installationId: z.string().regex(/^\d+$/).describe('Numeric GitHub App installation id'),
  accountLogin: z.string().min(1).max(255),
  accountType: z.string().min(1).max(100).optional(),
  repositorySelection: z.string().min(1).max(100).optional(),
  permissions: z.record(z.unknown()).optional(),
  events: z.array(z.string().min(1).max(100)).max(100).optional(),
  installedAt: z.string().datetime().optional(),
};

export async function githubInstallationRegister(
  ctx: ToolContext,
  input: {
    installationId: string;
    accountLogin: string;
    accountType?: string;
    repositorySelection?: string;
    permissions?: Record<string, unknown>;
    events?: string[];
    installedAt?: string;
  },
): Promise<ToolResult> {
  const response = await ctx.client.github.registerInstallation(input);
  return text(renderGithubInstallations([response.data]));
}
