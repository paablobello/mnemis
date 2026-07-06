import { parseArgs } from 'node:util';
import type {
  IndexStrategy,
  MemoryKind,
  PatchMemoryInput,
  SourceKind,
  SourceStatus,
} from '@mnemis/sdk';
import { clearCredentials, maskKey, readCredentials, writeCredentials } from './credentials.ts';
import {
  type McpClientTarget,
  type WriteOutcome,
  buildMnemisServerEntry,
  defaultMcpTargets,
  writeMcpEntry,
} from './init.ts';
import { err, out, prompt, readStdin } from './io.ts';
import {
  renderGithubInstallations,
  renderMemory,
  renderMemoryList,
  renderMemorySearch,
  renderResearchRun,
  renderResearchRuns,
  renderSearch,
  renderSource,
  renderSourceStatus,
  renderSources,
} from './render.ts';
import { type CliServices, NotAuthenticatedError } from './services.ts';

export interface CommandResult {
  exitCode: number;
}

const HELP_TEXT = `mnemis — CLI for the Mnemis memory & retrieval API

Usage:
  mnemis auth login [--url <url>] [--key <key>]
  mnemis auth logout
  mnemis auth status

  mnemis repos add <owner/repo> [--branch <name>] [--installation <id>]
                                [--strategy manual|webhook|cron] [--display-name <s>]
                                [--cron "*/15 * * * *"]
                                [--include <path>] [--exclude <path>]
                                [--max-file-bytes N] [--chunk-max-chars N]
                                [--contextual-prefix auto|always|never]

  mnemis docs add <url> [--display-name <s>] [--include <path>] [--exclude <path>]
                         [--focus <s>] [--max-pages N] [--no-robots]
                         [--strategy manual|cron] [--cron "0 3 * * *"]
                         [--contextual-prefix auto|always|never]
                         [--crawler auto|native|firecrawl]

  mnemis search <query> [--mode markdown|raw|synthesized] [--limit N]
                        [--source <uuid>] [--kind <source_kind>]
                        [--path-prefix <s>]

  mnemis research <query> [--depth quick|standard|deep] [--max-sources N]
                          [--url <url>] [--no-web] [--no-github] [--no-papers]
                          [--no-pdfs] [--no-index]
  mnemis research list [--status queued|processing|completed|failed] [--limit N]
  mnemis research get <id>

  mnemis memory save --kind <fact|procedural|session|working> --title <s> --summary <s>
                     [--body <s> | stdin] [--tag <t>] [--directory <s>] [--ttl N]
  mnemis memory list [--kind <k>] [--tag <t>] [--directory <s>] [--q <s>]
                     [--include-archived] [--include-expired] [--limit N] [--offset N]
  mnemis memory search <query> [--limit N] [--kind <k>] [--keyword]
  mnemis memory get <id> [--lineage]
  mnemis memory update <id> [--kind <k>] [--tag <t>] [--ttl N|--no-ttl]
                           [--archive|--unarchive] [--metadata-json <json>]
  mnemis memory archive <id>
  mnemis memory restore <id>
  mnemis memory delete <id> [--permanent --yes]

  mnemis sources list [--kind <k>] [--status <s>] [--limit N]
  mnemis sources get <id>
  mnemis sources status <id>
  mnemis sources reindex <id>
  mnemis status   (alias of sources list)

  mnemis github installations list
  mnemis github installations register --installation <id> --account <login>
                                      [--account-type <s>] [--repository-selection all|selected]
                                      [--event <name>] [--permissions-json <json>]

  mnemis init [--force] [--dry-run]
      Detect Claude Code, Cursor, Windsurf and Zed config files and append
      Mnemis as an MCP server.

Environment overrides:
  MNEMIS_API_URL, MNEMIS_API_KEY  Skip the credentials file when set.
  MNEMIS_CREDENTIALS_FILE         Override the default path.
`;

const SOURCE_KINDS = [
  'github_repo',
  'docs_site',
  'web_page',
  'pdf_document',
  'academic_paper',
  'research_collection',
] as const;
const SOURCE_STATUSES = ['pending', 'indexing', 'indexed', 'failed'] as const;
const RESEARCH_DEPTHS = ['quick', 'standard', 'deep'] as const;
const RESEARCH_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;
const INDEX_STRATEGIES = ['manual', 'webhook', 'cron'] as const;
const MEMORY_KINDS = ['working', 'session', 'fact', 'procedural'] as const;
const SEARCH_MODES = ['raw', 'markdown', 'synthesized'] as const;
const CONTEXTUAL_PREFIX_MODES = ['auto', 'always', 'never'] as const;
const DOCS_CRAWLERS = ['auto', 'native', 'firecrawl'] as const;

export function printHelp(): void {
  out(HELP_TEXT);
}

function fail(message: string): CommandResult {
  err(`error: ${message}`);
  return { exitCode: 1 };
}

function optionalEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${label} must be one of ${allowed.join('|')}`);
}

function requiredEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T {
  const parsed = optionalEnum(value, allowed, label);
  if (!parsed) throw new Error(`${label} is required`);
  return parsed;
}

function positiveInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function jsonObject(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function prepend(value: string | undefined, rest: string[]): string[] {
  return value === undefined ? rest : [value, ...rest];
}

/* -------------------------------------------------------------------------- */
/*  auth                                                                       */
/* -------------------------------------------------------------------------- */

export async function cmdAuthLogin(argv: string[], services: CliServices): Promise<CommandResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string' },
      key: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const url =
    values.url ?? ((await prompt('API URL [http://localhost:8787]: ')) || 'http://localhost:8787');
  const key = values.key ?? (await prompt('API key: ', { mask: true }));
  if (!key) return fail('API key is required');

  const file = await writeCredentials({ api_url: url, api_key: key }, services.env);
  out(`Saved credentials to ${file}`);
  return { exitCode: 0 };
}

export async function cmdAuthLogout(services: CliServices): Promise<CommandResult> {
  const removed = await clearCredentials(services.env);
  out(removed ? 'Logged out.' : 'No credentials file to remove.');
  return { exitCode: 0 };
}

export async function cmdAuthStatus(services: CliServices): Promise<CommandResult> {
  const credentials = await readCredentials(services.env);
  if (!credentials) {
    out('Not logged in. Run `mnemis auth login`.');
    return { exitCode: 0 };
  }
  out(`api_url: ${credentials.api_url}`);
  out(`api_key: ${maskKey(credentials.api_key)}`);
  return { exitCode: 0 };
}

/* -------------------------------------------------------------------------- */
/*  init                                                                       */
/* -------------------------------------------------------------------------- */

function describeOutcome(target: McpClientTarget, outcome: WriteOutcome): string {
  if (outcome.status === 'created') return `  ✓ ${target.name}: created ${outcome.path}`;
  if (outcome.status === 'updated')
    return `  ✓ ${target.name}: updated ${outcome.path} (backup at ${outcome.backup})`;
  return `  – ${target.name}: already configured at ${outcome.path}`;
}

export async function cmdInit(argv: string[], services: CliServices): Promise<CommandResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      force: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  });

  const credentials = await readCredentials(services.env);
  if (!credentials) {
    return fail("No credentials found. Run 'mnemis auth login' first.");
  }

  const targets = defaultMcpTargets(services.env);
  const entry = buildMnemisServerEntry({
    apiUrl: credentials.api_url,
    apiKey: credentials.api_key,
  });

  out('Configuring MCP servers…');
  if (values['dry-run']) {
    out('(dry-run mode: nothing is written)');
    for (const target of targets) {
      out(`  • ${target.name}: would write to ${target.path}`);
    }
    return { exitCode: 0 };
  }

  for (const target of targets) {
    try {
      const outcome = await writeMcpEntry(target, entry, { force: values.force });
      out(describeOutcome(target, outcome));
    } catch (caught) {
      err(`  ✗ ${target.name}: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }
  out('Done. Restart your MCP client to pick up the new server.');
  return { exitCode: 0 };
}

/* -------------------------------------------------------------------------- */
/*  repos / docs                                                               */
/* -------------------------------------------------------------------------- */

export async function cmdReposAdd(argv: string[], services: CliServices): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      branch: { type: 'string' },
      installation: { type: 'string' },
      strategy: { type: 'string' },
      cron: { type: 'string' },
      'display-name': { type: 'string' },
      include: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      'max-file-bytes': { type: 'string' },
      'chunk-max-chars': { type: 'string' },
      'contextual-prefix': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  const identifier = positionals[0];
  if (!identifier) return fail('Expected <owner/repo>');

  const strategy = optionalEnum(values.strategy, INDEX_STRATEGIES, '--strategy') ?? 'webhook';
  if (strategy === 'cron' && !values.cron) return fail('--cron is required when --strategy cron');
  if (strategy !== 'cron' && values.cron) return fail('--cron is only valid with --strategy cron');
  const contextualPrefixMode = optionalEnum(
    values['contextual-prefix'],
    CONTEXTUAL_PREFIX_MODES,
    '--contextual-prefix',
  );
  const maxFileBytes = positiveInt(values['max-file-bytes'], '--max-file-bytes');
  const chunkMaxChars = positiveInt(values['chunk-max-chars'], '--chunk-max-chars');

  const client = await services.client();
  const result = await client.sources.create({
    kind: 'github_repo',
    identifier,
    displayName: values['display-name'],
    config: {
      branch: values.branch,
      githubInstallationId: values.installation,
      includePaths: values.include,
      excludePaths: values.exclude,
      maxFileBytes,
      chunkMaxChars,
      contextualPrefixMode,
    },
    indexStrategy: strategy,
    cronSchedule: values.cron,
    enqueue: true,
  });

  out(`Registered ${result.data.identifier} (id ${result.data.id}, ${result.data.status}).`);
  if (result.job) out(`Indexing job: ${result.job.id} (${result.job.status}).`);
  return { exitCode: 0 };
}

export async function cmdDocsAdd(argv: string[], services: CliServices): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      'display-name': { type: 'string' },
      include: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      focus: { type: 'string' },
      'max-pages': { type: 'string' },
      'no-robots': { type: 'boolean' },
      strategy: { type: 'string' },
      cron: { type: 'string' },
      'contextual-prefix': { type: 'string' },
      crawler: { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  const url = positionals[0];
  if (!url) return fail('Expected <url>');

  const contextualPrefixMode = optionalEnum(
    values['contextual-prefix'],
    CONTEXTUAL_PREFIX_MODES,
    '--contextual-prefix',
  );
  const maxPages = positiveInt(values['max-pages'], '--max-pages');
  const docsCrawler = optionalEnum(values.crawler, DOCS_CRAWLERS, '--crawler');
  const strategy =
    optionalEnum(values.strategy, ['manual', 'cron'] as const, '--strategy') ?? 'manual';
  if (strategy === 'cron' && !values.cron) return fail('--cron is required when --strategy cron');
  if (strategy !== 'cron' && values.cron) return fail('--cron is only valid with --strategy cron');

  const client = await services.client();
  const result = await client.sources.create({
    kind: 'docs_site',
    identifier: url,
    displayName: values['display-name'],
    config: {
      includePaths: values.include,
      excludePaths: values.exclude,
      focusInstructions: values.focus,
      maxPages,
      respectRobots: values['no-robots'] ? false : undefined,
      docsCrawler,
      contextualPrefixMode,
    },
    indexStrategy: strategy,
    cronSchedule: values.cron,
    enqueue: true,
  });

  out(`Registered ${result.data.identifier} (id ${result.data.id}, ${result.data.status}).`);
  if (result.job) out(`Indexing job: ${result.job.id} (${result.job.status}).`);
  return { exitCode: 0 };
}

/* -------------------------------------------------------------------------- */
/*  search                                                                     */
/* -------------------------------------------------------------------------- */

export async function cmdSearch(argv: string[], services: CliServices): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      mode: { type: 'string' },
      limit: { type: 'string' },
      source: { type: 'string', multiple: true },
      kind: { type: 'string', multiple: true },
      'path-prefix': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  const query = positionals.join(' ').trim();
  if (!query) return fail('Expected a search query');

  const mode = optionalEnum(values.mode, SEARCH_MODES, '--mode') ?? 'markdown';
  const limit = positiveInt(values.limit, '--limit');
  const kinds = values.kind?.map((kind) => requiredEnum(kind, SOURCE_KINDS, '--kind'));

  const client = await services.client();
  const response = await client.search({
    query,
    mode,
    limit,
    sourceIds: values.source as string[] | undefined,
    kinds,
    pathPrefix: values['path-prefix'],
  });

  out(renderSearch(response));
  return { exitCode: 0 };
}

/* -------------------------------------------------------------------------- */
/*  research                                                                   */
/* -------------------------------------------------------------------------- */

export async function cmdResearchCreate(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      depth: { type: 'string' },
      'max-sources': { type: 'string' },
      url: { type: 'string', multiple: true },
      'no-web': { type: 'boolean' },
      'no-github': { type: 'boolean' },
      'no-papers': { type: 'boolean' },
      'no-pdfs': { type: 'boolean' },
      'no-index': { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });
  const query = positionals.join(' ').trim();
  if (!query) return fail('Expected a research query');

  const depth = optionalEnum(values.depth, RESEARCH_DEPTHS, '--depth');
  const maxSources = positiveInt(values['max-sources'], '--max-sources');
  const client = await services.client();
  const result = await client.research.create({
    query,
    depth,
    maxSources,
    urls: values.url as string[] | undefined,
    includeWeb: values['no-web'] ? false : undefined,
    includeGithub: values['no-github'] ? false : undefined,
    includePapers: values['no-papers'] ? false : undefined,
    includePdfs: values['no-pdfs'] ? false : undefined,
    index: values['no-index'] ? false : undefined,
  });

  out(`Queued research run ${result.data.id} (${result.data.status}).`);
  out(`Job: ${result.job.id} (${result.job.status}).`);
  return { exitCode: 0 };
}

export async function cmdResearchList(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      status: { type: 'string' },
      limit: { type: 'string' },
      q: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const status = optionalEnum(values.status, RESEARCH_STATUSES, '--status');
  const limit = positiveInt(values.limit, '--limit');
  const client = await services.client();
  const response = await client.research.list({ status, limit, q: values.q });
  out(renderResearchRuns(response));
  return { exitCode: 0 };
}

export async function cmdResearchGet(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { positionals } = parseArgs({
    args: argv,
    options: {},
    allowPositionals: true,
    strict: true,
  });
  const id = positionals[0];
  if (!id) return fail('Expected <research_run_id>');
  const client = await services.client();
  const response = await client.research.get(id);
  out(renderResearchRun(response.data));
  return { exitCode: 0 };
}

/* -------------------------------------------------------------------------- */
/*  memory                                                                     */
/* -------------------------------------------------------------------------- */

export async function cmdMemorySave(argv: string[], services: CliServices): Promise<CommandResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      kind: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      body: { type: 'string' },
      directory: { type: 'string' },
      tag: { type: 'string', multiple: true },
      ttl: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const kind = requiredEnum(values.kind, MEMORY_KINDS, '--kind');
  if (!values.title) return fail('--title is required');
  if (!values.summary) return fail('--summary is required');

  let body = values.body;
  if (!body) {
    const stdin = await readStdin();
    body = stdin.trim();
  }
  if (!body) return fail('Body required via --body or stdin');

  const ttlSeconds = nonNegativeInt(values.ttl, '--ttl');

  const client = await services.client();
  const memory = await client.memories.create({
    kind,
    title: values.title,
    summary: values.summary,
    body,
    tags: values.tag as string[] | undefined,
    directory: values.directory,
    ttlSeconds,
    agentOrigin: 'cli',
  });

  out(`Saved memory ${memory.id} (kind: ${memory.kind})`);
  if (memory.expires_at) out(`Expires: ${memory.expires_at}`);
  return { exitCode: 0 };
}

export async function cmdMemorySearch(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      limit: { type: 'string' },
      kind: { type: 'string' },
      keyword: { type: 'boolean' },
      tag: { type: 'string', multiple: true },
      directory: { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  const query = positionals.join(' ').trim();
  if (!query) return fail('Expected a search query');

  const kind = optionalEnum(values.kind, MEMORY_KINDS, '--kind') as MemoryKind | undefined;
  const limit = positiveInt(values.limit, '--limit');
  const input = {
    query,
    kind,
    tags: values.tag as string[] | undefined,
    directory: values.directory,
    limit,
  };
  const client = await services.client();
  const response = values.keyword
    ? await client.memories.search(input)
    : await client.memories.semanticSearch(input);
  out(renderMemorySearch(response, false));
  return { exitCode: 0 };
}

export async function cmdMemoryList(argv: string[], services: CliServices): Promise<CommandResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      kind: { type: 'string' },
      tag: { type: 'string' },
      directory: { type: 'string' },
      q: { type: 'string' },
      'include-archived': { type: 'boolean' },
      'include-expired': { type: 'boolean' },
      lineage: { type: 'boolean' },
      limit: { type: 'string' },
      offset: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const kind = optionalEnum(values.kind, MEMORY_KINDS, '--kind') as MemoryKind | undefined;
  const limit = positiveInt(values.limit, '--limit');
  const offset = nonNegativeInt(values.offset, '--offset');
  const client = await services.client();
  const response = await client.memories.list({
    kind,
    tag: values.tag,
    directory: values.directory,
    q: values.q,
    includeArchived: values['include-archived'],
    includeExpired: values['include-expired'],
    include: values.lineage ? ['lineage'] : undefined,
    limit,
    offset,
  });
  out(renderMemoryList(response, false));
  return { exitCode: 0 };
}

export async function cmdMemoryGet(argv: string[], services: CliServices): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { lineage: { type: 'boolean' } },
    allowPositionals: true,
    strict: true,
  });
  const id = positionals[0];
  if (!id) return fail('Expected <memory_id>');

  const client = await services.client();
  const memory = await client.memories.get(id, values.lineage ? { include: 'lineage' } : undefined);
  out(renderMemory(memory));
  return { exitCode: 0 };
}

export async function cmdMemoryUpdate(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      kind: { type: 'string' },
      tag: { type: 'string', multiple: true },
      ttl: { type: 'string' },
      'no-ttl': { type: 'boolean' },
      archive: { type: 'boolean' },
      unarchive: { type: 'boolean' },
      'metadata-json': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  const id = positionals[0];
  if (!id) return fail('Expected <memory_id>');
  if (values.ttl !== undefined && values['no-ttl']) {
    return fail('Use either --ttl or --no-ttl, not both');
  }
  if (values.archive && values.unarchive) {
    return fail('Use either --archive or --unarchive, not both');
  }

  const input: PatchMemoryInput = {};
  const kind = optionalEnum(values.kind, MEMORY_KINDS, '--kind') as MemoryKind | undefined;
  if (kind) input.kind = kind;
  if (values.tag) input.tags = values.tag as string[];
  if (values.ttl !== undefined) input.ttlSeconds = nonNegativeInt(values.ttl, '--ttl');
  if (values['no-ttl']) input.ttlSeconds = null;
  if (values.archive) input.archived = true;
  if (values.unarchive) input.archived = false;
  const metadata = jsonObject(values['metadata-json'], '--metadata-json');
  if (metadata) input.metadata = metadata;
  if (Object.keys(input).length === 0) return fail('At least one update option is required');

  const client = await services.client();
  const memory = await client.memories.patch(id, input);
  out(renderMemory(memory));
  return { exitCode: 0 };
}

export async function cmdMemoryArchive(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { positionals } = parseArgs({
    args: argv,
    options: {},
    allowPositionals: true,
    strict: true,
  });
  const id = positionals[0];
  if (!id) return fail('Expected <memory_id>');
  const client = await services.client();
  const memory = await client.memories.patch(id, { archived: true });
  out(`Archived memory ${memory.id}`);
  return { exitCode: 0 };
}

export async function cmdMemoryRestore(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { positionals } = parseArgs({
    args: argv,
    options: {},
    allowPositionals: true,
    strict: true,
  });
  const id = positionals[0];
  if (!id) return fail('Expected <memory_id>');
  const client = await services.client();
  const memory = await client.memories.patch(id, { archived: false });
  out(`Restored memory ${memory.id}`);
  return { exitCode: 0 };
}

export async function cmdMemoryDelete(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { permanent: { type: 'boolean' }, yes: { type: 'boolean' } },
    allowPositionals: true,
    strict: true,
  });
  const id = positionals[0];
  if (!id) return fail('Expected <memory_id>');
  if (values.permanent && !values.yes) {
    return fail('Permanent delete requires --yes');
  }
  const client = await services.client();
  await client.memories.remove(id, { permanent: values.permanent });
  out(values.permanent ? `Permanently deleted memory ${id}` : `Deleted memory ${id}`);
  return { exitCode: 0 };
}

/* -------------------------------------------------------------------------- */
/*  sources / status                                                           */
/* -------------------------------------------------------------------------- */

export async function cmdSourcesList(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      kind: { type: 'string' },
      status: { type: 'string' },
      limit: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const kind = optionalEnum(values.kind, SOURCE_KINDS, '--kind') as SourceKind | undefined;
  const status = optionalEnum(values.status, SOURCE_STATUSES, '--status') as
    | SourceStatus
    | undefined;
  const limit = positiveInt(values.limit, '--limit');

  const client = await services.client();
  const response = await client.sources.list({
    kind,
    status,
    limit,
  });
  out(renderSources(response));
  return { exitCode: 0 };
}

export async function cmdSourcesStatus(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: { follow: { type: 'boolean' } },
  });
  const id = positionals[0];
  if (!id) return fail('Expected <source_id>');

  const client = await services.client();
  if (!values.follow) {
    const status = await client.sources.status(id);
    out(renderSourceStatus(status));
    return { exitCode: 0 };
  }

  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.on('SIGINT', onSignal);
  try {
    await client.sources.streamStatus(
      id,
      (event) => {
        if (event.event === 'progress') out(`[progress] ${renderSourceStatus(event.data)}\n`);
        else out(`[done] ${renderSourceStatus(event.data)}`);
      },
      { signal: controller.signal },
    );
  } finally {
    process.off('SIGINT', onSignal);
  }
  return { exitCode: 0 };
}

export async function cmdSourcesGet(argv: string[], services: CliServices): Promise<CommandResult> {
  const { positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {},
  });
  const id = positionals[0];
  if (!id) return fail('Expected <source_id>');

  const client = await services.client();
  const response = await client.sources.get(id);
  out(renderSource(response.data));
  return { exitCode: 0 };
}

export async function cmdSourcesReindex(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {},
  });
  const id = positionals[0];
  if (!id) return fail('Expected <source_id>');

  const client = await services.client();
  const response = await client.sources.reindex(id);
  out(`Queued reindex job ${response.job.id} (${response.job.status})`);
  return { exitCode: 0 };
}

/* -------------------------------------------------------------------------- */
/*  github                                                                     */
/* -------------------------------------------------------------------------- */

export async function cmdGithubInstallationsList(
  _argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const client = await services.client();
  const response = await client.github.listInstallations();
  out(renderGithubInstallations(response.items));
  return { exitCode: 0 };
}

export async function cmdGithubInstallationsRegister(
  argv: string[],
  services: CliServices,
): Promise<CommandResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      installation: { type: 'string' },
      account: { type: 'string' },
      'account-type': { type: 'string' },
      'repository-selection': { type: 'string' },
      event: { type: 'string', multiple: true },
      'permissions-json': { type: 'string' },
      'installed-at': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.installation) return fail('--installation is required');
  if (!values.account) return fail('--account is required');

  const client = await services.client();
  const response = await client.github.registerInstallation({
    installationId: values.installation,
    accountLogin: values.account,
    accountType: values['account-type'],
    repositorySelection: values['repository-selection'],
    permissions: jsonObject(values['permissions-json'], '--permissions-json'),
    events: values.event as string[] | undefined,
    installedAt: values['installed-at'],
  });
  out(renderGithubInstallations([response.data]));
  return { exitCode: 0 };
}

/* -------------------------------------------------------------------------- */
/*  dispatch                                                                   */
/* -------------------------------------------------------------------------- */

export async function dispatch(argv: string[], services: CliServices): Promise<CommandResult> {
  const [first, second, ...rest] = argv;
  if (!first || first === '--help' || first === '-h' || first === 'help') {
    printHelp();
    return { exitCode: 0 };
  }

  try {
    if (first === 'auth') {
      if (second === 'login') return await cmdAuthLogin(rest, services);
      if (second === 'logout') return await cmdAuthLogout(services);
      if (second === 'status') return await cmdAuthStatus(services);
      return fail(`Unknown auth subcommand: ${second ?? '(none)'}`);
    }
    if (first === 'repos' && second === 'add') return await cmdReposAdd(rest, services);
    if (first === 'docs' && second === 'add') return await cmdDocsAdd(rest, services);
    if (first === 'search') return await cmdSearch(prepend(second, rest), services);
    if (first === 'research') {
      if (second === 'list' || !second) return await cmdResearchList(rest, services);
      if (second === 'get') return await cmdResearchGet(rest, services);
      return await cmdResearchCreate(prepend(second, rest), services);
    }
    if (first === 'memory') {
      if (second === 'save') return await cmdMemorySave(rest, services);
      if (second === 'list' || !second) return await cmdMemoryList(rest, services);
      if (second === 'search') return await cmdMemorySearch(rest, services);
      if (second === 'get') return await cmdMemoryGet(rest, services);
      if (second === 'update') return await cmdMemoryUpdate(rest, services);
      if (second === 'archive') return await cmdMemoryArchive(rest, services);
      if (second === 'restore') return await cmdMemoryRestore(rest, services);
      if (second === 'delete') return await cmdMemoryDelete(rest, services);
      return fail(`Unknown memory subcommand: ${second ?? '(none)'}`);
    }
    if (first === 'sources') {
      if (second === 'list' || !second) return await cmdSourcesList(rest, services);
      if (second === 'get') return await cmdSourcesGet(rest, services);
      if (second === 'status') return await cmdSourcesStatus(rest, services);
      if (second === 'reindex') return await cmdSourcesReindex(rest, services);
      return fail(`Unknown sources subcommand: ${second}`);
    }
    if (first === 'github') {
      if (second === 'installations') {
        const [third, ...githubRest] = rest;
        if (third === 'list' || !third)
          return await cmdGithubInstallationsList(githubRest, services);
        if (third === 'register') {
          return await cmdGithubInstallationsRegister(githubRest, services);
        }
        return fail(`Unknown github installations subcommand: ${third}`);
      }
      return fail(`Unknown github subcommand: ${second ?? '(none)'}`);
    }
    if (first === 'status') return await cmdSourcesList(prepend(second, rest), services);
    if (first === 'init')
      return await cmdInit([second, ...rest].filter(Boolean) as string[], services);
    return fail(`Unknown command: ${first}. Run 'mnemis help' for usage.`);
  } catch (caught) {
    if (caught instanceof NotAuthenticatedError) {
      return fail(caught.message);
    }
    if (caught instanceof Error) {
      return fail(caught.message);
    }
    return fail(String(caught));
  }
}
