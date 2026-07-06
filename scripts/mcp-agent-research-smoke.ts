import { randomBytes, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  apiKeyHash,
  apiKeyPrefix,
  apiKeys,
  chunks,
  createDatabase,
  eq,
  sources,
  sql,
  users,
  workspaces,
} from '../packages/db/src/index.ts';

const API_URL = process.env.MNEMIS_API_URL?.trim() || 'http://127.0.0.1:8787';
const MCP_ENTRY = join(process.cwd(), 'apps/mcp/dist/index.js');
const configuredResearchTimeout = Number.parseInt(
  process.env.MNEMIS_AGENT_RESEARCH_TIMEOUT_MS ?? '',
  10,
);
const RESEARCH_TIMEOUT_MS =
  Number.isFinite(configuredResearchTimeout) && configuredResearchTimeout > 0
    ? configuredResearchTimeout
    : 180_000;
const POLL_INTERVAL_MS = 2_000;

type ToolResult = {
  content?: Array<{ type?: string; text?: string }>;
};

interface ResearchCheck {
  id: string;
  indexed: number;
  completed: boolean;
  failed: boolean;
  statusText: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function generateKey(): { raw: string; hash: string; prefix: string } {
  const raw = `mn_${randomBytes(24).toString('hex')}`;
  return {
    raw,
    hash: apiKeyHash(raw, process.env.INTERNAL_AUTH_SECRET),
    prefix: apiKeyPrefix(raw),
  };
}

function toolText(result: ToolResult): string {
  return (result.content ?? []).map((item) => item.text ?? '').join('\n');
}

function firstUuid(value: string): string | null {
  return value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
}

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasSearchHit(value: string): boolean {
  return !/_No indexed content|No results|No sources registered|No memories found/i.test(value);
}

async function ensureMcpBuild(): Promise<void> {
  try {
    await access(MCP_ENTRY);
  } catch (err) {
    throw new Error('MCP build not found at apps/mcp/dist/index.js. Run `bun run build` first.', {
      cause: err,
    });
  }
}

async function ensureApiHealthy(): Promise<void> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error(`Mnemis API health check failed: HTTP ${res.status}`);
  const json = (await res.json()) as { status?: string; checks?: { db?: { status?: string } } };
  if (json.status !== 'ok' || json.checks?.db?.status !== 'ok') {
    throw new Error(`Mnemis API is not healthy: ${JSON.stringify(json)}`);
  }
}

async function createAuditWorkspace(db: ReturnType<typeof createDatabase>): Promise<{
  apiKey: string;
  slug: string;
  userEmail: string;
  workspaceId: string;
}> {
  const suffix = `${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const slug = `mcp-agent-research-${suffix}`;
  const userEmail = `${slug}@mnemis.local`;

  const [user] = await db
    .insert(users)
    .values({ email: userEmail, name: 'mcp agent research smoke' })
    .returning();
  assertOk(user, 'failed to create MCP agent research user');

  const [workspace] = await db
    .insert(workspaces)
    .values({ slug, name: slug, ownerId: user.id })
    .returning();
  assertOk(workspace, 'failed to create MCP agent research workspace');

  const key = generateKey();
  await db.insert(apiKeys).values({
    workspaceId: workspace.id,
    name: 'mcp-agent-research-smoke',
    keyHash: key.hash,
    prefix: key.prefix,
    scopes: ['memories:*', 'sources:*', 'search:*', 'research:*', 'admin:*'],
  });

  return { apiKey: key.raw, slug, userEmail, workspaceId: workspace.id };
}

async function cleanupAuditWorkspace(
  db: ReturnType<typeof createDatabase>,
  input: { slug: string; userEmail: string } | null,
): Promise<void> {
  if (!input || process.env.MNEMIS_AGENT_RESEARCH_KEEP === 'true') return;
  await db.delete(workspaces).where(eq(workspaces.slug, input.slug));
  await db.delete(users).where(eq(users.email, input.userEmail));
}

async function sourceSummary(db: ReturnType<typeof createDatabase>, workspaceId: string) {
  return db
    .select({
      id: sources.id,
      kind: sources.kind,
      identifier: sources.identifier,
      status: sources.status,
      statusMessage: sources.statusMessage,
      chunkCount: sql<number>`count(${chunks.id})::int`,
      embeddedCount: sql<number>`count(${chunks.embedding})::int`,
    })
    .from(sources)
    .leftJoin(chunks, eq(chunks.sourceId, sources.id))
    .where(eq(sources.workspaceId, workspaceId))
    .groupBy(sources.id)
    .orderBy(sources.kind, sources.identifier);
}

async function main(): Promise<void> {
  requireEnv('DATABASE_URL');
  await ensureMcpBuild();
  await ensureApiHealthy();

  const db = createDatabase({ url: process.env.DATABASE_URL! });
  let audit: Awaited<ReturnType<typeof createAuditWorkspace>> | null = null;
  const summary: Record<string, unknown> = {};
  const hardFailures: string[] = [];

  try {
    audit = await createAuditWorkspace(db);
    summary.workspace = audit.slug;
    summary.workspaceKept = process.env.MNEMIS_AGENT_RESEARCH_KEEP === 'true';

    const transport = new StdioClientTransport({
      command: 'node',
      args: [MCP_ENTRY],
      cwd: process.cwd(),
      env: {
        ...process.env,
        MNEMIS_API_URL: API_URL,
        MNEMIS_API_KEY: audit.apiKey,
      },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => process.stderr.write(String(chunk)));

    const client = new Client(
      { name: 'mnemis-mcp-agent-research-smoke', version: '0.0.0' },
      { capabilities: {} },
    );
    const callTool = (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args }) as Promise<ToolResult>;

    async function runResearch(
      label: string,
      input: Record<string, unknown>,
    ): Promise<ResearchCheck> {
      const queued = toolText(await callTool('mnemis_research', input));
      const id = firstUuid(queued);
      assertOk(id, `${label}: mnemis_research did not return a research run id`);

      let statusText = '';
      const deadline = Date.now() + RESEARCH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        statusText = toolText(await callTool('mnemis_research_status', { id }));
        if (/`completed`|`failed`|completed|failed/.test(statusText)) break;
        await sleep(POLL_INTERVAL_MS);
      }

      const indexed = Number(statusText.match(/indexed: (\d+)/)?.[1] ?? 0);
      const completed = /`completed`|completed/.test(statusText);
      const failed = /`failed`|failed/.test(statusText);
      return { id, indexed, completed, failed, statusText };
    }

    try {
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      const requiredTools = [
        'mnemis_research',
        'mnemis_research_and_remember',
        'mnemis_research_status',
        'source_search',
        'source_list',
        'memory_save',
        'memory_search',
      ];
      summary.toolCount = toolNames.length;
      summary.requiredToolsPresent = requiredTools.every((name) => toolNames.includes(name));
      assertOk(
        summary.requiredToolsPresent,
        `missing required MCP tools: ${requiredTools.join(', ')}`,
      );

      const webResearch = await runResearch('web discovery', {
        query: 'Chrome DevTools MCP server browser automation performance trace AI coding agents',
        depth: 'quick',
        maxSources: 2,
        includeWeb: true,
        includeGithub: false,
        includePapers: false,
        includePdfs: true,
        index: true,
        urls: [],
      });
      summary.webResearchId = webResearch.id;
      summary.webResearchIndexed = webResearch.indexed;
      summary.webResearchCompleted = webResearch.completed;
      summary.webResearchStatus = webResearch.statusText;
      if (!webResearch.completed || webResearch.indexed === 0) {
        hardFailures.push('web discovery did not complete with indexed sources');
      }

      const githubResearch = await runResearch('GitHub repository discovery', {
        query: 'model context protocol typescript sdk github repository',
        depth: 'quick',
        maxSources: 1,
        includeWeb: false,
        includeGithub: true,
        includePapers: false,
        includePdfs: false,
        index: false,
        urls: [],
      });
      summary.githubResearchId = githubResearch.id;
      summary.githubResearchCompleted = githubResearch.completed;
      summary.githubResearchStatus = githubResearch.statusText;
      if (!githubResearch.completed) {
        hardFailures.push('GitHub repository discovery did not complete');
      }

      const paperResearch = await runResearch('academic discovery', {
        query: 'retrieval augmented generation reranking citations evaluation benchmark survey',
        depth: 'quick',
        maxSources: 3,
        includeWeb: false,
        includeGithub: false,
        includePapers: true,
        includePdfs: true,
        index: true,
        urls: [],
      });
      summary.paperResearchId = paperResearch.id;
      summary.paperResearchIndexed = paperResearch.indexed;
      summary.paperResearchCompleted = paperResearch.completed;
      summary.paperResearchStatus = paperResearch.statusText;
      if (!paperResearch.completed || paperResearch.indexed === 0) {
        hardFailures.push('academic discovery did not complete with indexed sources');
      }

      const dbSources = await sourceSummary(db, audit.workspaceId);
      summary.sources = dbSources.map((source) => ({
        kind: source.kind,
        identifier: source.identifier,
        status: source.status,
        statusMessage: source.statusMessage,
        chunks: source.chunkCount,
        embedded: source.embeddedCount,
      }));
      const anySearchableSource = dbSources.some(
        (source) => source.status === 'indexed' && source.chunkCount > 0,
      );
      summary.anySearchableSource = anySearchableSource;
      if (!anySearchableSource) hardFailures.push('research indexed no searchable chunks');

      const webSearch = toolText(
        await callTool('source_search', {
          query: 'Chrome DevTools MCP performance trace browser automation',
          mode: 'markdown',
          kinds: ['web_page'],
          limit: 5,
        }),
      );
      summary.webSourceSearchHit = hasSearchHit(webSearch);
      if (!summary.webSourceSearchHit) {
        hardFailures.push('source_search did not return web research content');
      }

      const paperSearch = toolText(
        await callTool('source_search', {
          query: 'retrieval augmented generation reranking citations evaluation',
          mode: 'markdown',
          kinds: ['academic_paper', 'pdf_document'],
          limit: 5,
        }),
      );
      summary.paperSourceSearchHit = hasSearchHit(paperSearch);
      if (!summary.paperSourceSearchHit) {
        hardFailures.push('source_search did not return academic research content');
      }

      const savedMemory = toolText(
        await callTool('memory_save', {
          kind: 'procedural',
          title: 'MCP autonomous research smoke',
          summary:
            'An MCP agent ran web and academic discovery without seed URLs, searched the indexed corpus, and saved this reusable memory.',
          body: [
            '# MCP autonomous research smoke',
            '',
            `Web research run: ${webResearch.id}, indexed sources: ${webResearch.indexed}`,
            `Academic research run: ${paperResearch.id}, indexed sources: ${paperResearch.indexed}`,
            '',
            'Indexed sources:',
            ...dbSources.map(
              (source) =>
                `- ${source.kind} ${source.identifier}: ${source.status}, chunks=${source.chunkCount}, embedded=${source.embeddedCount}${source.statusMessage ? `, message=${source.statusMessage}` : ''}`,
            ),
          ].join('\n'),
          tags: ['agent-research-smoke'],
          directory: '/qa/mcp-agent-research',
          agentOrigin: 'mcp-agent-research-smoke',
        }),
      );
      const memoryId = firstUuid(savedMemory);
      summary.memorySaved = Boolean(memoryId);
      assertOk(memoryId, 'memory_save did not return a memory id');

      const memorySearch = toolText(
        await callTool('memory_search', {
          query: 'MCP autonomous research web academic discovery reusable memory',
          tags: ['agent-research-smoke'],
          directory: '/qa/mcp-agent-research',
          semantic: true,
          limit: 3,
        }),
      );
      summary.memorySearchHit = memorySearch.includes('MCP autonomous research smoke');
      if (!summary.memorySearchHit)
        hardFailures.push('memory_search did not return the saved memory');
    } finally {
      await client.close().catch(() => {});
    }
  } finally {
    await cleanupAuditWorkspace(db, audit);
  }

  summary.hardFailures = hardFailures;
  console.log(JSON.stringify(summary, null, 2));
  if (hardFailures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
