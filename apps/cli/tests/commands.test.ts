import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type {
  ChunkSearchResponse,
  CreateMemoryInput,
  CreateResearchRunInput,
  CreateSourceInput,
  GitHubInstallationDto,
  JobDto,
  MemoryDto,
  MemorySearchResponse,
  MnemisClient,
  PatchMemoryInput,
  ResearchRunDto,
  SourceDto,
  SourceListResponse,
  SourceStatusDto,
} from '@mnemis/sdk';
import { dispatch } from '../src/commands.ts';
import { readCredentials } from '../src/credentials.ts';
import type { CliServices } from '../src/services.ts';

function job(overrides: Partial<JobDto> = {}): JobDto {
  return {
    id: 'job-1',
    kind: 'index_source',
    status: 'queued',
    payload: {},
    progress: {},
    result: null,
    error: null,
    attempts: 0,
    scheduled_at: '2026-05-20T00:00:00.000Z',
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function source(overrides: Partial<SourceDto> = {}): SourceDto {
  return {
    id: 'source-1',
    kind: 'github_repo',
    identifier: 'owner/repo',
    display_name: 'owner/repo',
    config: {},
    last_indexed_at: null,
    last_change_at: null,
    index_strategy: 'webhook',
    cron_schedule: null,
    status: 'pending',
    status_message: 'Index job queued',
    created_at: '2026-05-20T00:00:00.000Z',
    updated_at: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

function memory(overrides: Partial<MemoryDto> = {}): MemoryDto {
  return {
    id: 'memory-1',
    kind: 'fact',
    title: 'Important',
    summary: 'Something useful',
    body: 'Body',
    tags: [],
    directory: null,
    file_overlap: [],
    agent_origin: 'cli',
    ttl_seconds: null,
    expires_at: null,
    archived_at: null,
    has_embedding: false,
    metadata: {},
    created_at: '2026-05-20T00:00:00.000Z',
    updated_at: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

function githubInstallation(overrides: Partial<GitHubInstallationDto> = {}): GitHubInstallationDto {
  return {
    id: 'ghi-1',
    workspace_id: 'workspace-1',
    installation_id: '12345',
    account_login: 'owner',
    account_type: 'Organization',
    repository_selection: 'selected',
    permissions: {},
    events: ['push'],
    installed_at: '2026-05-20T00:00:00.000Z',
    suspended_at: null,
    deleted_at: null,
    created_at: '2026-05-20T00:00:00.000Z',
    updated_at: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

function researchRun(overrides: Partial<ResearchRunDto> = {}): ResearchRunDto {
  return {
    id: 'run-1',
    workspace_id: 'workspace-1',
    query: 'state of the art',
    depth: 'deep',
    status: 'queued',
    config: {},
    result: null,
    error: null,
    created_at: '2026-05-20T00:00:00.000Z',
    updated_at: '2026-05-20T00:00:00.000Z',
    completed_at: null,
    ...overrides,
  };
}

function services(client: Partial<MnemisClient>, env: NodeJS.ProcessEnv = {}): CliServices {
  return {
    env,
    fetch,
    async client() {
      return client as MnemisClient;
    },
  };
}

async function capture<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string; stderr: string }> {
  const stdout = process.stdout;
  const stderr = process.stderr;
  const writeOut = stdout.write;
  const writeErr = stderr.write;
  const outChunks: string[] = [];
  const errChunks: string[] = [];

  stdout.write = ((chunk: unknown) => {
    outChunks.push(String(chunk));
    return true;
  }) as typeof stdout.write;
  stderr.write = ((chunk: unknown) => {
    errChunks.push(String(chunk));
    return true;
  }) as typeof stderr.write;

  try {
    const result = await fn();
    return { result, stdout: outChunks.join(''), stderr: errChunks.join('') };
  } finally {
    stdout.write = writeOut;
    stderr.write = writeErr;
  }
}

describe('auth commands', () => {
  it('logs in, reports status and logs out using a credentials file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mnemis-cli-'));
    const env = { MNEMIS_CREDENTIALS_FILE: join(dir, 'credentials.json') } as NodeJS.ProcessEnv;
    try {
      const svc = services({}, env);
      const login = await capture(() =>
        dispatch(
          ['auth', 'login', '--url', 'http://localhost:8787', '--key', 'mn_test_1234567890abcdef'],
          svc,
        ),
      );
      assert.equal(login.result.exitCode, 0);

      const raw = JSON.parse(await readFile(env.MNEMIS_CREDENTIALS_FILE!, 'utf8')) as {
        api_url: string;
        api_key: string;
      };
      assert.equal(raw.api_url, 'http://localhost:8787');
      assert.equal(raw.api_key, 'mn_test_1234567890abcdef');

      const status = await capture(() => dispatch(['auth', 'status'], svc));
      assert.match(status.stdout, /api_url: http:\/\/localhost:8787/);
      assert.match(status.stdout, /api_key: mn_test_.*cdef/);

      const logout = await capture(() => dispatch(['auth', 'logout'], svc));
      assert.equal(logout.result.exitCode, 0);
      assert.equal(await readCredentials(env), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('source commands', () => {
  it('registers GitHub repos with indexer config', async () => {
    const inputs: CreateSourceInput[] = [];
    const svc = services({
      sources: {
        async create(value: CreateSourceInput) {
          inputs.push(value);
          return { data: source(), job: job() };
        },
      } as MnemisClient['sources'],
    });

    const result = await capture(() =>
      dispatch(
        [
          'repos',
          'add',
          'Owner/Repo',
          '--branch',
          'main',
          '--installation',
          '12345',
          '--strategy',
          'webhook',
          '--include',
          'apps/api',
          '--exclude',
          'node_modules',
          '--max-file-bytes',
          '1048576',
          '--contextual-prefix',
          'auto',
        ],
        svc,
      ),
    );

    assert.equal(result.result.exitCode, 0);
    const input = inputs[0];
    assert.ok(input);
    assert.equal(input.kind, 'github_repo');
    assert.equal(input.identifier, 'Owner/Repo');
    assert.deepEqual(input.config, {
      branch: 'main',
      githubInstallationId: '12345',
      includePaths: ['apps/api'],
      excludePaths: ['node_modules'],
      maxFileBytes: 1048576,
      chunkMaxChars: undefined,
      contextualPrefixMode: 'auto',
    });
  });

  it('registers docs sites with crawler config', async () => {
    const inputs: CreateSourceInput[] = [];
    const svc = services({
      sources: {
        async create(value: CreateSourceInput) {
          inputs.push(value);
          return {
            data: source({ kind: 'docs_site', identifier: 'https://docs.example.com' }),
            job: job(),
          };
        },
      } as MnemisClient['sources'],
    });

    const result = await capture(() =>
      dispatch(
        [
          'docs',
          'add',
          'https://docs.example.com',
          '--include',
          '/api',
          '--exclude',
          '/blog',
          '--focus',
          'API reference only',
          '--max-pages',
          '50',
          '--no-robots',
          '--crawler',
          'firecrawl',
        ],
        svc,
      ),
    );

    assert.equal(result.result.exitCode, 0);
    const input = inputs[0];
    assert.ok(input);
    assert.equal(input.kind, 'docs_site');
    assert.deepEqual(input.config, {
      includePaths: ['/api'],
      excludePaths: ['/blog'],
      focusInstructions: 'API reference only',
      maxPages: 50,
      respectRobots: false,
      docsCrawler: 'firecrawl',
      contextualPrefixMode: undefined,
    });
  });

  it('passes cron schedule for scheduled docs indexing', async () => {
    const inputs: CreateSourceInput[] = [];
    const svc = services({
      sources: {
        async create(value: CreateSourceInput) {
          inputs.push(value);
          return {
            data: source({
              kind: 'docs_site',
              identifier: 'https://docs.example.com',
              index_strategy: 'cron',
              cron_schedule: '0 3 * * *',
            }),
            job: job(),
          };
        },
      } as MnemisClient['sources'],
    });

    const result = await capture(() =>
      dispatch(
        ['docs', 'add', 'https://docs.example.com', '--strategy', 'cron', '--cron', '0 3 * * *'],
        svc,
      ),
    );

    assert.equal(result.result.exitCode, 0);
    assert.equal(inputs[0]?.indexStrategy, 'cron');
    assert.equal(inputs[0]?.cronSchedule, '0 3 * * *');
  });

  it('lists status through the status alias', async () => {
    const calls: unknown[] = [];
    const svc = services({
      sources: {
        async list(query: unknown): Promise<SourceListResponse> {
          calls.push(query);
          return { items: [source({ status: 'indexed' })], total: 1, has_more: false };
        },
      } as MnemisClient['sources'],
    });

    const result = await capture(() =>
      dispatch(['status', '--kind', 'github_repo', '--limit', '5'], svc),
    );
    assert.equal(result.result.exitCode, 0);
    assert.deepEqual(calls[0], { kind: 'github_repo', status: undefined, limit: 5 });
  });

  it('renders source status by id', async () => {
    const svc = services({
      sources: {
        async status(id: string): Promise<SourceStatusDto> {
          assert.equal(id, 'source-1');
          return { source: source({ status: 'indexed' }), chunk_count: 12, latest_job: job() };
        },
      } as MnemisClient['sources'],
    });

    const output = await capture(() => dispatch(['sources', 'status', 'source-1'], svc));
    assert.match(output.stdout, /chunks:\s+12/);
  });

  it('gets a source and queues reindex jobs', async () => {
    const calls: string[] = [];
    const svc = services({
      sources: {
        async get(id: string) {
          calls.push(`get:${id}`);
          return { data: source({ id, status: 'indexed' }) };
        },
        async reindex(id: string) {
          calls.push(`reindex:${id}`);
          return { job: job({ id: 'job-reindex', kind: 'reindex_source' }) };
        },
      } as MnemisClient['sources'],
    });

    const get = await capture(() => dispatch(['sources', 'get', 'source-1'], svc));
    const reindex = await capture(() => dispatch(['sources', 'reindex', 'source-1'], svc));

    assert.equal(get.result.exitCode, 0);
    assert.match(get.stdout, /source-1/);
    assert.equal(reindex.result.exitCode, 0);
    assert.match(reindex.stdout, /job-reindex/);
    assert.deepEqual(calls, ['get:source-1', 'reindex:source-1']);
  });
});

describe('research commands', () => {
  it('creates, lists and gets research runs', async () => {
    const inputs: CreateResearchRunInput[] = [];
    const calls: string[] = [];
    const svc = services({
      research: {
        async create(value: CreateResearchRunInput) {
          inputs.push(value);
          return { data: researchRun(), job: job({ kind: 'research_run' }) };
        },
        async list(query) {
          calls.push(`list:${query?.status ?? ''}:${query?.limit ?? ''}`);
          return { items: [researchRun()], total: 1, has_more: false };
        },
        async get(id: string) {
          calls.push(`get:${id}`);
          return { data: researchRun({ id, status: 'completed', result: { indexed_sources: 2 } }) };
        },
      } as MnemisClient['research'],
    });

    const created = await capture(() =>
      dispatch(
        [
          'research',
          'state',
          'of',
          'the',
          'art',
          '--depth',
          'deep',
          '--max-sources',
          '20',
          '--url',
          'https://example.com/paper.pdf',
        ],
        svc,
      ),
    );
    const listed = await capture(() =>
      dispatch(['research', 'list', '--status', 'queued', '--limit', '5'], svc),
    );
    const got = await capture(() => dispatch(['research', 'get', 'run-1'], svc));

    assert.equal(created.result.exitCode, 0);
    assert.deepEqual(inputs[0], {
      query: 'state of the art',
      depth: 'deep',
      maxSources: 20,
      urls: ['https://example.com/paper.pdf'],
      includeWeb: undefined,
      includePapers: undefined,
      includePdfs: undefined,
      index: undefined,
    });
    assert.equal(listed.result.exitCode, 0);
    assert.equal(got.result.exitCode, 0);
    assert.deepEqual(calls, ['list:queued:5', 'get:run-1']);
    assert.match(created.stdout, /Queued research run/);
    assert.match(listed.stdout, /Research runs/);
    assert.match(got.stdout, /indexed:\s+2/);
  });
});

describe('search and memory commands', () => {
  it('searches sources and renders markdown responses', async () => {
    const calls: unknown[] = [];
    const response: ChunkSearchResponse = {
      query: 'contextual retrieval',
      mode: 'markdown',
      retrieval: 'hybrid_rrf',
      used_vector: true,
      embedding_model: null,
      embedding_tokens: 0,
      reranked: false,
      reranker_model: null,
      reranker_tokens: 0,
      items: [],
      citations: [],
      count: 0,
      markdown: '# Results',
    };
    const svc = services({
      async search(input: unknown) {
        calls.push(input);
        return response;
      },
    });

    const output = await capture(() =>
      dispatch(
        [
          'search',
          'contextual',
          'retrieval',
          '--mode',
          'markdown',
          '--kind',
          'docs_site',
          '--limit',
          '3',
        ],
        svc,
      ),
    );

    assert.match(output.stdout, /# Results/);
    assert.deepEqual(calls[0], {
      query: 'contextual retrieval',
      mode: 'markdown',
      limit: 3,
      sourceIds: undefined,
      kinds: ['docs_site'],
      pathPrefix: undefined,
    });
  });

  it('saves memories with CLI origin and tags', async () => {
    const inputs: CreateMemoryInput[] = [];
    const svc = services({
      memories: {
        async create(value: CreateMemoryInput) {
          inputs.push(value);
          return memory({ id: 'memory-123', title: value.title });
        },
      } as unknown as MnemisClient['memories'],
    });

    const result = await capture(() =>
      dispatch(
        [
          'memory',
          'save',
          '--kind',
          'fact',
          '--title',
          'Important',
          '--summary',
          'A useful fact',
          '--body',
          'The body',
          '--tag',
          'phase-4',
          '--ttl',
          '0',
        ],
        svc,
      ),
    );

    assert.equal(result.result.exitCode, 0);
    const input = inputs[0];
    assert.ok(input);
    assert.equal(input.agentOrigin, 'cli');
    assert.deepEqual(input.tags, ['phase-4']);
    assert.equal(input.ttlSeconds, 0);
  });

  it('searches memories semantically by default and by keyword on --keyword', async () => {
    const calls: string[] = [];
    const searchResponse = (mode: MemorySearchResponse['mode']): MemorySearchResponse => ({
      query: 'query',
      mode,
      embedding_model: mode === 'keyword' ? undefined : null,
      embedding_tokens: mode === 'keyword' ? undefined : 0,
      reranked: false,
      reranker_model: null,
      reranker_tokens: 0,
      items: [
        {
          score: 0.42,
          ranks: { bm25: 1, vector: mode === 'keyword' ? null : 2 },
          bm25_score: 0.42,
          vector_score: mode === 'keyword' ? null : 0.37,
          memory: memory({ title: 'Search Hit' }),
        },
      ],
      count: 1,
    });
    const svc = services({
      memories: {
        async search() {
          calls.push('keyword');
          return searchResponse('keyword');
        },
        async semanticSearch() {
          calls.push('semantic');
          return searchResponse('hybrid_rrf');
        },
      } as unknown as MnemisClient['memories'],
    });

    const semantic = await capture(() => dispatch(['memory', 'search', 'query'], svc));
    const keyword = await capture(() => dispatch(['memory', 'search', 'query', '--keyword'], svc));

    assert.equal(semantic.result.exitCode, 0);
    assert.equal(keyword.result.exitCode, 0);
    assert.match(semantic.stdout, /Memory search/);
    assert.match(semantic.stdout, /Search Hit/);
    assert.match(semantic.stdout, /vector #2/);
    assert.deepEqual(calls, ['semantic', 'keyword']);
  });

  it('lists memories with filters', async () => {
    const calls: unknown[] = [];
    const svc = services({
      memories: {
        async list(query: unknown) {
          calls.push(query);
          return {
            items: [memory({ title: 'Filtered', tags: ['phase-4'] })],
            total: 1,
            has_more: false,
          };
        },
      } as MnemisClient['memories'],
    });

    const output = await capture(() =>
      dispatch(
        [
          'memory',
          'list',
          '--kind',
          'fact',
          '--tag',
          'phase-4',
          '--directory',
          '/repo',
          '--q',
          'filter',
          '--include-archived',
          '--limit',
          '10',
          '--offset',
          '5',
          '--lineage',
        ],
        svc,
      ),
    );

    assert.equal(output.result.exitCode, 0);
    assert.match(output.stdout, /Filtered/);
    assert.deepEqual(calls[0], {
      kind: 'fact',
      tag: 'phase-4',
      directory: '/repo',
      q: 'filter',
      includeArchived: true,
      includeExpired: undefined,
      include: ['lineage'],
      limit: 10,
      offset: 5,
    });
  });

  it('updates, archives, restores and deletes memories', async () => {
    const patches: Array<{ id: string; input: PatchMemoryInput }> = [];
    const deletes: Array<{ id: string; permanent?: boolean }> = [];
    const svc = services({
      memories: {
        async patch(id: string, input: PatchMemoryInput) {
          patches.push({ id, input });
          return memory({ id, archived_at: input.archived ? '2026-05-20T00:00:00.000Z' : null });
        },
        async remove(id: string, options?: { permanent?: boolean }) {
          deletes.push({ id, permanent: options?.permanent });
        },
      } as MnemisClient['memories'],
    });

    await capture(() =>
      dispatch(
        [
          'memory',
          'update',
          'memory-1',
          '--kind',
          'procedural',
          '--tag',
          'cli',
          '--no-ttl',
          '--metadata-json',
          '{"source":"test"}',
        ],
        svc,
      ),
    );
    await capture(() => dispatch(['memory', 'archive', 'memory-1'], svc));
    await capture(() => dispatch(['memory', 'restore', 'memory-1'], svc));
    const blocked = await capture(() =>
      dispatch(['memory', 'delete', 'memory-1', '--permanent'], svc),
    );
    await capture(() => dispatch(['memory', 'delete', 'memory-1', '--permanent', '--yes'], svc));
    assert.equal(blocked.result.exitCode, 1);
    assert.match(blocked.stderr, /requires --yes/);

    assert.deepEqual(patches, [
      {
        id: 'memory-1',
        input: {
          kind: 'procedural',
          tags: ['cli'],
          ttlSeconds: null,
          metadata: { source: 'test' },
        },
      },
      { id: 'memory-1', input: { archived: true } },
      { id: 'memory-1', input: { archived: false } },
    ]);
    assert.deepEqual(deletes, [{ id: 'memory-1', permanent: true }]);
  });

  it('fails before client creation on invalid numbers', async () => {
    let clientCalls = 0;
    const svc: CliServices = {
      env: {},
      fetch,
      async client() {
        clientCalls++;
        return {} as MnemisClient;
      },
    };

    const output = await capture(async () => {
      const result = await dispatch(['search', 'query', '--limit', 'nope'], svc);
      assert.equal(result.exitCode, 1);
    });

    assert.equal(clientCalls, 0);
    assert.match(output.stderr, /--limit must be a positive integer/);
  });
});

describe('github commands', () => {
  it('lists and registers GitHub App installations', async () => {
    const registrations: unknown[] = [];
    const svc = services({
      github: {
        async listInstallations() {
          return { items: [githubInstallation()] };
        },
        async registerInstallation(input: unknown) {
          registrations.push(input);
          return { data: githubInstallation({ account_login: 'new-owner' }) };
        },
      } as MnemisClient['github'],
    });

    const list = await capture(() => dispatch(['github', 'installations', 'list'], svc));
    const register = await capture(() =>
      dispatch(
        [
          'github',
          'installations',
          'register',
          '--installation',
          '67890',
          '--account',
          'new-owner',
          '--account-type',
          'Organization',
          '--repository-selection',
          'selected',
          '--event',
          'push',
          '--permissions-json',
          '{"contents":"read"}',
        ],
        svc,
      ),
    );

    assert.match(list.stdout, /owner/);
    assert.match(register.stdout, /new-owner/);
    assert.deepEqual(registrations[0], {
      installationId: '67890',
      accountLogin: 'new-owner',
      accountType: 'Organization',
      repositorySelection: 'selected',
      permissions: { contents: 'read' },
      events: ['push'],
      installedAt: undefined,
    });
  });
});

describe('init wizard', () => {
  it('writes mcpServers.mnemis to detected client configs', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mnemis-cli-home-'));
    const xdg = join(home, '.config');
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      XDG_CONFIG_HOME: xdg,
      MNEMIS_CREDENTIALS_FILE: join(home, 'credentials.json'),
    };
    try {
      await writeFile(
        env.MNEMIS_CREDENTIALS_FILE!,
        JSON.stringify({ api_url: 'http://localhost:8787', api_key: 'mn_test_key' }),
      );

      const svc = services({}, env);
      const result = await capture(() => dispatch(['init'], svc));
      assert.equal(result.result.exitCode, 0);
      assert.match(result.stdout, /Configuring MCP servers/);

      const claudePath = join(home, '.claude', 'settings.json');
      const claude = JSON.parse(await readFile(claudePath, 'utf8')) as {
        mcpServers: Record<string, { command: string; env?: Record<string, string> }>;
      };
      assert.equal(claude.mcpServers.mnemis!.command, 'npx');
      assert.equal(claude.mcpServers.mnemis!.env?.MNEMIS_API_URL, 'http://localhost:8787');
      assert.equal(claude.mcpServers.mnemis!.env?.MNEMIS_API_KEY, 'mn_test_key');

      const zedPath = join(xdg, 'zed', 'settings.json');
      const zed = JSON.parse(await readFile(zedPath, 'utf8')) as {
        context_servers: Record<string, { command: string }>;
      };
      assert.equal(zed.context_servers.mnemis!.command, 'npx');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('preserves existing servers when writing the new entry', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mnemis-cli-home-'));
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      MNEMIS_CREDENTIALS_FILE: join(home, 'credentials.json'),
    };
    try {
      await writeFile(
        env.MNEMIS_CREDENTIALS_FILE!,
        JSON.stringify({ api_url: 'http://localhost:8787', api_key: 'mn_test_key' }),
      );
      const cursorPath = join(home, '.cursor', 'mcp.json');
      await mkdir(join(home, '.cursor'), { recursive: true });
      await writeFile(
        cursorPath,
        JSON.stringify({
          mcpServers: {
            other: { command: 'node', args: ['./other.js'], env: { FOO: 'bar' } },
          },
        }),
      );

      const svc = services({}, env);
      const result = await capture(() => dispatch(['init'], svc));
      assert.equal(result.result.exitCode, 0);

      const cursor = JSON.parse(await readFile(cursorPath, 'utf8')) as {
        mcpServers: Record<string, unknown>;
      };
      assert.ok(cursor.mcpServers.other);
      assert.ok(cursor.mcpServers.mnemis);

      const backup = await readFile(`${cursorPath}.mnemis.bak`, 'utf8');
      assert.match(backup, /other/);
      assert.doesNotMatch(backup, /mnemis/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('fails when no credentials are configured', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mnemis-cli-home-'));
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      MNEMIS_CREDENTIALS_FILE: join(home, 'no-such-file.json'),
    };
    try {
      const svc = services({}, env);
      const result = await capture(() => dispatch(['init'], svc));
      assert.equal(result.result.exitCode, 1);
      assert.match(result.stderr, /No credentials found/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
