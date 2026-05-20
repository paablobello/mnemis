#!/usr/bin/env node
import { createMnemisClient } from '@mnemis/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.ts';
import {
  type ToolContext,
  memoryRetrieve,
  memoryRetrieveInput,
  memorySave,
  memorySaveInput,
  memorySearch,
  memorySearchInput,
  sourceIndex,
  sourceIndexInput,
  sourceList,
  sourceListInput,
  sourceSearch,
  sourceSearchInput,
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
      'Search memories. Hybrid BM25+vector when semantic=true (default), keyword-only when false.',
    inputSchema: memorySearchInput,
  },
  // biome-ignore lint/suspicious/noExplicitAny: SDK callback signature uses unknown
  (input: any) => memorySearch(ctx, input),
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

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
