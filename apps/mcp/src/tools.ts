import { z } from 'zod';
import type { MnemisClient } from './client.ts';

export interface ToolContext {
  client: MnemisClient;
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

interface SourceSearchItem {
  source_identifier: string;
  source_display_name: string;
  path: string;
  line_start: number;
  line_end: number;
  permalink: string | null;
  last_indexed_at: string | null;
  citation_number: number;
  raw_text?: string;
}

interface SourceSearchResponse {
  mode: 'raw' | 'markdown' | 'synthesized';
  query: string;
  retrieval: string;
  used_vector: boolean;
  count: number;
  items: SourceSearchItem[];
  markdown?: string;
  answer?: string;
  synthesis_model?: string;
}

interface MemoryDto {
  id: string;
  kind: string;
  title: string;
  summary: string;
  body?: string;
  tags?: string[];
  directory?: string | null;
  created_at: string;
  expires_at?: string | null;
  source_ids?: string[];
  confidence?: number | null;
  agent_origin?: string | null;
}

interface MemoryListResponse {
  items: MemoryDto[];
  total: number;
  has_more: boolean;
}

interface SourceDto {
  id: string;
  kind: string;
  identifier: string;
  display_name: string;
  status: string;
  status_message: string | null;
  last_indexed_at: string | null;
  cron_schedule: string | null;
  index_strategy: string;
}

interface SourceListResponse {
  items: SourceDto[];
  total: number;
  has_more: boolean;
}

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function jsonText(value: unknown): ToolResult {
  return text(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
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
    .array(z.enum(['github_repo', 'docs_site']))
    .max(2)
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
    kinds?: string[];
    pathPrefix?: string;
  },
): Promise<ToolResult> {
  const response = await ctx.client.request<SourceSearchResponse>('POST', '/v1/search', {
    query: input.query,
    mode: input.mode,
    limit: input.limit,
    sourceIds: input.sourceIds,
    kinds: input.kinds,
    pathPrefix: input.pathPrefix,
  });

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
/*  source_index                                                               */
/* -------------------------------------------------------------------------- */

export const sourceIndexInput = {
  kind: z.enum(['github_repo', 'docs_site']).describe('Source type'),
  identifier: z
    .string()
    .min(1)
    .max(2_000)
    .describe('owner/repo for github_repo, full URL for docs_site'),
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
};

export async function sourceIndex(
  ctx: ToolContext,
  input: {
    kind: 'github_repo' | 'docs_site';
    identifier: string;
    displayName?: string;
    branch?: string;
    githubInstallationId?: string;
    indexStrategy?: 'manual' | 'webhook' | 'cron';
  },
): Promise<ToolResult> {
  const config: Record<string, unknown> = {};
  if (input.branch) config.branch = input.branch;
  if (input.githubInstallationId) config.githubInstallationId = input.githubInstallationId;

  const response = await ctx.client.request<{
    data: SourceDto;
    job: { id: string; kind: string; status: string } | null;
  }>('POST', '/v1/sources', {
    kind: input.kind,
    identifier: input.identifier,
    displayName: input.displayName,
    config: Object.keys(config).length > 0 ? config : undefined,
    indexStrategy: input.indexStrategy ?? 'manual',
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
  kind: z.enum(['github_repo', 'docs_site']).optional().describe('Filter by source kind'),
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
  input: { kind?: string; status?: string; q?: string; limit?: number },
): Promise<ToolResult> {
  const params = new URLSearchParams();
  if (input.kind) params.set('kind', input.kind);
  if (input.status) params.set('status', input.status);
  if (input.q) params.set('q', input.q);
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  const path = `/v1/sources${params.size > 0 ? `?${params.toString()}` : ''}`;
  const response = await ctx.client.request<SourceListResponse>('GET', path);
  return text(renderSourceList(response));
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
  const response = await ctx.client.request<{ data: MemoryDto }>('POST', '/v1/memories', input);
  const m = response.data;
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
    .describe('Use hybrid semantic+BM25 search when true (default), keyword-only when false'),
};

export async function memorySearch(
  ctx: ToolContext,
  input: {
    query: string;
    kind?: string;
    tags?: string[];
    directory?: string;
    limit?: number;
    semantic: boolean;
  },
): Promise<ToolResult> {
  const path = input.semantic ? '/v1/memories/semantic-search' : '/v1/memories/search';
  const body = {
    query: input.query,
    kind: input.kind,
    tags: input.tags,
    directory: input.directory,
    limit: input.limit,
  };
  const response = await ctx.client.request<MemoryListResponse>('POST', path, body);
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
  const params = input.includeLineage ? '?include=lineage' : '';
  const response = await ctx.client.request<{ data: MemoryDto }>(
    'GET',
    `/v1/memories/${input.id}${params}`,
  );
  return text(renderMemoryList({ items: [response.data], total: 1, has_more: false }, true));
}
