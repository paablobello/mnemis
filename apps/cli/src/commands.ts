import { parseArgs } from 'node:util';
import type { IndexStrategy, MemoryKind, SourceKind, SourceStatus } from '@mnemis/sdk';
import { clearCredentials, maskKey, readCredentials, writeCredentials } from './credentials.ts';
import { err, out, prompt, readStdin } from './io.ts';
import {
  renderMemory,
  renderMemoryList,
  renderSearch,
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
                                [--include <path>] [--exclude <path>]
                                [--max-file-bytes N] [--chunk-max-chars N]
                                [--contextual-prefix auto|always|never]

  mnemis docs add <url> [--display-name <s>] [--include <path>] [--exclude <path>]
                         [--focus <s>] [--max-pages N] [--no-robots]
                         [--contextual-prefix auto|always|never]

  mnemis search <query> [--mode markdown|raw|synthesized] [--limit N]
                        [--source <uuid>] [--kind github_repo|docs_site]
                        [--path-prefix <s>]

  mnemis memory save --kind <fact|procedural|session|working> --title <s> --summary <s>
                     [--body <s> | stdin] [--tag <t>] [--directory <s>] [--ttl N]
  mnemis memory search <query> [--limit N] [--kind <k>] [--keyword]
  mnemis memory get <id> [--lineage]

  mnemis sources list [--kind <k>] [--status <s>] [--limit N]
  mnemis sources status <id>
  mnemis status   (alias of sources list)

Environment overrides:
  MNEMIS_API_URL, MNEMIS_API_KEY  Skip the credentials file when set.
  MNEMIS_CREDENTIALS_FILE         Override the default path.
`;

const SOURCE_KINDS = ['github_repo', 'docs_site'] as const;
const SOURCE_STATUSES = ['pending', 'indexing', 'indexed', 'failed'] as const;
const INDEX_STRATEGIES = ['manual', 'webhook', 'cron'] as const;
const MEMORY_KINDS = ['working', 'session', 'fact', 'procedural'] as const;
const SEARCH_MODES = ['raw', 'markdown', 'synthesized'] as const;
const CONTEXTUAL_PREFIX_MODES = ['auto', 'always', 'never'] as const;

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
/*  repos / docs                                                               */
/* -------------------------------------------------------------------------- */

export async function cmdReposAdd(argv: string[], services: CliServices): Promise<CommandResult> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      branch: { type: 'string' },
      installation: { type: 'string' },
      strategy: { type: 'string' },
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
      'contextual-prefix': { type: 'string' },
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
      contextualPrefixMode,
    },
    indexStrategy: 'manual',
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
  const { positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {},
  });
  const id = positionals[0];
  if (!id) return fail('Expected <source_id>');

  const client = await services.client();
  const status = await client.sources.status(id);
  out(renderSourceStatus(status));
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
    if (first === 'memory') {
      if (second === 'save') return await cmdMemorySave(rest, services);
      if (second === 'search') return await cmdMemorySearch(rest, services);
      if (second === 'get') return await cmdMemoryGet(rest, services);
      return fail(`Unknown memory subcommand: ${second ?? '(none)'}`);
    }
    if (first === 'sources') {
      if (second === 'list' || !second) return await cmdSourcesList(rest, services);
      if (second === 'status') return await cmdSourcesStatus(rest, services);
      return fail(`Unknown sources subcommand: ${second}`);
    }
    if (first === 'status') return await cmdSourcesList(prepend(second, rest), services);
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
