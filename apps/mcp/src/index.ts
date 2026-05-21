#!/usr/bin/env node
import { createMnemisClient } from '@mnemis/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.ts';
import {
  type ToolContext,
  githubInstallationList,
  githubInstallationListInput,
  githubInstallationRegister,
  githubInstallationRegisterInput,
  memoryDelete,
  memoryDeleteInput,
  memoryList,
  memoryListInput,
  memoryRetrieve,
  memoryRetrieveInput,
  memorySave,
  memorySaveInput,
  memorySearch,
  memorySearchInput,
  memoryUpdate,
  memoryUpdateInput,
  research,
  researchInput,
  researchList,
  researchListInput,
  researchStatus,
  researchStatusInput,
  sourceGet,
  sourceGetInput,
  sourceIndex,
  sourceIndexInput,
  sourceList,
  sourceListInput,
  sourceReindex,
  sourceReindexInput,
  sourceSearch,
  sourceSearchInput,
  sourceStatus,
  sourceStatusInput,
} from './tools.ts';

const config = loadConfig();
const client = createMnemisClient({
  apiUrl: config.MNEMIS_API_URL,
  apiKey: config.MNEMIS_API_KEY,
});
const ctx: ToolContext = { client };

const server = new McpServer({ name: 'mnemis', version: '0.0.0' }, { capabilities: { tools: {} } });

server.registerTool(
  'source_search',
  {
    description:
      'Search indexed repositories and documentation. Returns markdown with citations and permalinks by default; pass mode="raw" for JSON chunks or mode="synthesized" for an LLM answer with citations.',
    inputSchema: sourceSearchInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => sourceSearch(ctx, input),
);

server.registerTool(
  'source_index',
  {
    description:
      'Register a new source (GitHub repo or docs site) and enqueue an indexing job. For private GitHub repos pass githubInstallationId.',
    inputSchema: sourceIndexInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => sourceIndex(ctx, input),
);

server.registerTool(
  'source_list',
  {
    description: 'List sources registered in this workspace.',
    inputSchema: sourceListInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => sourceList(ctx, input),
);

server.registerTool(
  'source_get',
  {
    description: 'Fetch one source by id, including stored source config.',
    inputSchema: sourceGetInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => sourceGet(ctx, input),
);

server.registerTool(
  'source_status',
  {
    description: 'Fetch source status, latest indexing job, and indexed chunk count.',
    inputSchema: sourceStatusInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => sourceStatus(ctx, input),
);

server.registerTool(
  'source_reindex',
  {
    description: 'Queue a reindex job for an existing source.',
    inputSchema: sourceReindexInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => sourceReindex(ctx, input),
);

server.registerTool(
  'mnemis_research',
  {
    description:
      'Run a full research workflow: discover web pages, academic papers and PDFs, then index the selected sources with citations.',
    inputSchema: researchInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => research(ctx, input),
);

server.registerTool(
  'mnemis_research_status',
  {
    description: 'Fetch one research run by id.',
    inputSchema: researchStatusInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => researchStatus(ctx, input),
);

server.registerTool(
  'mnemis_research_list',
  {
    description: 'List recent research runs.',
    inputSchema: researchListInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => researchList(ctx, input),
);

server.registerTool(
  'memory_save',
  {
    description:
      'Persist a memory (fact/procedural/session/working). The chosen kind sets the default TTL (fact and procedural never expire).',
    inputSchema: memorySaveInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => memorySave(ctx, input),
);

server.registerTool(
  'memory_search',
  {
    description:
      'Search memories. Hybrid Postgres full-text + vector when semantic=true (default), keyword-only when false.',
    inputSchema: memorySearchInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => memorySearch(ctx, input),
);

server.registerTool(
  'memory_list',
  {
    description: 'List memories with filters for kind, tag, directory, archived/expired state.',
    inputSchema: memoryListInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => memoryList(ctx, input),
);

server.registerTool(
  'memory_retrieve',
  {
    description: 'Fetch the full body of a single memory by id.',
    inputSchema: memoryRetrieveInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => memoryRetrieve(ctx, input),
);

server.registerTool(
  'memory_update',
  {
    description:
      'Patch memory metadata fields only: kind, tags, ttlSeconds, archived, metadata. Body/title/summary are immutable; save a new memory with derivedFrom for content changes.',
    inputSchema: memoryUpdateInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => memoryUpdate(ctx, input),
);

server.registerTool(
  'memory_delete',
  {
    description: 'Delete a memory. Defaults to soft archive; permanent=true hard-deletes.',
    inputSchema: memoryDeleteInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => memoryDelete(ctx, input),
);

server.registerTool(
  'github_installation_list',
  {
    description: 'List GitHub App installations linked to this workspace.',
    inputSchema: githubInstallationListInput,
  },
  () => githubInstallationList(ctx),
);

server.registerTool(
  'github_installation_register',
  {
    description: 'Register or update a GitHub App installation for private repository indexing.',
    inputSchema: githubInstallationRegisterInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => githubInstallationRegister(ctx, input),
);

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
