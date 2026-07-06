import { randomBytes, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  apiKeyHash,
  apiKeyPrefix,
  apiKeys,
  createDatabase,
  eq,
  users,
  workspaces,
} from '../packages/db/src/index.ts';

const API_URL = process.env.MNEMIS_API_URL?.trim() || 'http://127.0.0.1:8787';
const MCP_ENTRY = join(process.cwd(), 'apps/mcp/dist/index.js');
const SOURCE_INDEX_TIMEOUT_MS = 90_000;
const RESEARCH_TIMEOUT_MS = 90_000;

type ToolResult = {
  content?: Array<{ type?: string; text?: string }>;
};

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
  const slug = `mcp-live-smoke-${suffix}`;
  const userEmail = `${slug}@mnemis.local`;

  const [user] = await db
    .insert(users)
    .values({ email: userEmail, name: 'mcp live smoke' })
    .returning();
  assertOk(user, 'failed to create MCP smoke user');

  const [workspace] = await db
    .insert(workspaces)
    .values({ slug, name: slug, ownerId: user.id })
    .returning();
  assertOk(workspace, 'failed to create MCP smoke workspace');

  const key = generateKey();
  await db.insert(apiKeys).values({
    workspaceId: workspace.id,
    name: 'mcp-live-smoke',
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
  if (!input) return;
  await db.delete(workspaces).where(eq(workspaces.slug, input.slug));
  await db.delete(users).where(eq(users.email, input.userEmail));
}

async function main(): Promise<void> {
  requireEnv('DATABASE_URL');
  await ensureMcpBuild();
  await ensureApiHealthy();

  const db = createDatabase({ url: process.env.DATABASE_URL! });
  let audit: Awaited<ReturnType<typeof createAuditWorkspace>> | null = null;
  const summary: Record<string, unknown> = {};

  try {
    audit = await createAuditWorkspace(db);
    summary.workspace = audit.slug;

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
      { name: 'mnemis-mcp-live-smoke', version: '0.0.0' },
      { capabilities: {} },
    );
    const callTool = (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args }) as Promise<ToolResult>;

    try {
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      const requiredTools = [
        'memory_save',
        'memory_search',
        'source_index',
        'source_status',
        'source_search',
        'mnemis_research',
        'mnemis_research_and_remember',
        'mnemis_research_status',
        'mnemis_research_list',
      ];
      summary.toolCount = toolNames.length;
      summary.requiredToolsPresent = requiredTools.every((name) => toolNames.includes(name));
      assertOk(
        summary.requiredToolsPresent,
        `missing required MCP tools: ${requiredTools.join(', ')}`,
      );

      const savedMemory = toolText(
        await callTool('memory_save', {
          kind: 'fact',
          title: 'MCP live smoke memory',
          summary: 'Memory created through the MCP live smoke test.',
          body: 'The MCP server can persist and retrieve memories through the Mnemis API.',
          tags: ['mcp-live-smoke'],
          directory: '/qa/mcp-live-smoke',
          agentOrigin: 'mcp-live-smoke',
        }),
      );
      const memoryId = firstUuid(savedMemory);
      summary.memorySaved = Boolean(memoryId);
      assertOk(memoryId, 'memory_save did not return a memory id');

      const memorySearch = toolText(
        await callTool('memory_search', {
          query: 'MCP server persist retrieve memories',
          tags: ['mcp-live-smoke'],
          directory: '/qa/mcp-live-smoke',
          semantic: true,
          limit: 3,
        }),
      );
      summary.memorySearchHit = memorySearch.includes('MCP live smoke memory');
      assertOk(summary.memorySearchHit, 'memory_search did not return the saved memory');

      const indexed = toolText(
        await callTool('source_index', {
          kind: 'web_page',
          identifier: 'https://react.dev/reference/react/useActionState',
          displayName: 'MCP live smoke React useActionState',
        }),
      );
      const sourceId = firstUuid(indexed);
      summary.sourceRegistered = Boolean(sourceId);
      assertOk(sourceId, 'source_index did not return a source id');

      let sourceStatus = '';
      const sourceDeadline = Date.now() + SOURCE_INDEX_TIMEOUT_MS;
      while (Date.now() < sourceDeadline) {
        sourceStatus = toolText(await callTool('source_status', { id: sourceId }));
        if (/status: indexed/.test(sourceStatus) || /status: failed/.test(sourceStatus)) break;
        await sleep(2_000);
      }
      summary.sourceIndexed = /status: indexed/.test(sourceStatus);
      summary.sourceChunks = Number(sourceStatus.match(/chunks: (\d+)/)?.[1] ?? 0);
      assertOk(summary.sourceIndexed, `source did not index successfully:\n${sourceStatus}`);
      assertOk(Number(summary.sourceChunks) > 0, 'source indexed but produced no chunks');

      const sourceSearch = toolText(
        await callTool('source_search', {
          query: 'form submission action state',
          mode: 'markdown',
          sourceIds: [sourceId],
          limit: 3,
        }),
      );
      summary.sourceSearchHit = /useActionState|form submission/i.test(sourceSearch);
      assertOk(summary.sourceSearchHit, 'source_search did not return expected indexed content');

      const queuedResearch = toolText(
        await callTool('mnemis_research', {
          query: 'MCP live smoke seed URL research run',
          depth: 'quick',
          maxSources: 1,
          includeWeb: false,
          includeGithub: false,
          includePapers: false,
          includePdfs: true,
          index: true,
          urls: ['https://blog.logrocket.com/react-useactionstate/'],
        }),
      );
      const researchId = firstUuid(queuedResearch);
      summary.researchQueued = Boolean(researchId);
      assertOk(researchId, 'mnemis_research did not return a research run id');

      let researchStatus = '';
      const researchDeadline = Date.now() + RESEARCH_TIMEOUT_MS;
      while (Date.now() < researchDeadline) {
        researchStatus = toolText(await callTool('mnemis_research_status', { id: researchId }));
        if (/completed|failed/.test(researchStatus)) break;
        await sleep(2_000);
      }
      summary.researchCompleted = /completed/.test(researchStatus);
      summary.researchIndexed = /indexed: [1-9]/.test(researchStatus);
      assertOk(summary.researchCompleted, `research run did not complete:\n${researchStatus}`);
      assertOk(
        summary.researchIndexed,
        `research run completed without indexed sources:\n${researchStatus}`,
      );

      const researchList = toolText(await callTool('mnemis_research_list', { limit: 3 }));
      summary.researchListHit = researchList.includes(researchId);
      assertOk(
        summary.researchListHit,
        'mnemis_research_list did not include the new research run',
      );
    } finally {
      await client.close().catch(() => {});
    }
  } finally {
    await cleanupAuditWorkspace(db, audit);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
