import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMnemisClient } from '../src/client.ts';
import type { McpConfig } from '../src/config.ts';
import {
  memoryRetrieve,
  memorySave,
  memorySearch,
  sourceIndex,
  sourceList,
  sourceSearch,
} from '../src/tools.ts';

const CONFIG: McpConfig = {
  MNEMIS_API_URL: 'http://localhost:9999',
  MNEMIS_API_KEY: 'test-key',
};

interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
  authorization: string;
}

function mockFetch(handler: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const headers = new Headers(init?.headers ?? undefined);
    const call: RecordedCall = {
      method: String(init?.method ?? 'GET'),
      url,
      body,
      authorization: headers.get('authorization') ?? '',
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fakeFetch, calls };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('source_search tool', () => {
  it('calls /v1/search with mode=markdown and returns the markdown body', async () => {
    const mock = mockFetch(() =>
      jsonResponse({
        mode: 'markdown',
        query: 'q',
        retrieval: 'hybrid_rrf',
        used_vector: true,
        count: 1,
        items: [],
        markdown: '# Results\n[1] hit',
      }),
    );
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    const result = await sourceSearch({ client }, { query: 'how does X work', mode: 'markdown' });
    assert.equal(mock.calls[0]!.method, 'POST');
    assert.equal(mock.calls[0]!.url, 'http://localhost:9999/v1/search');
    assert.equal(mock.calls[0]!.authorization, 'Bearer test-key');
    assert.equal((mock.calls[0]!.body as { mode: string }).mode, 'markdown');
    assert.equal(result.content[0]!.text, '# Results\n[1] hit');
  });

  it('renders synthesized mode with model footer', async () => {
    const mock = mockFetch(() =>
      jsonResponse({
        mode: 'synthesized',
        query: 'q',
        retrieval: 'hybrid_rrf',
        used_vector: true,
        count: 1,
        items: [],
        answer: 'It uses contextual prefixes [1].',
        synthesis_model: 'claude-3-5-haiku-latest',
      }),
    );
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    const result = await sourceSearch({ client }, { query: 'how', mode: 'synthesized' });
    assert.match(result.content[0]!.text, /\[1\]/);
    assert.match(result.content[0]!.text, /claude-3-5-haiku-latest/);
  });

  it('passes through filters in the request body', async () => {
    const mock = mockFetch(() =>
      jsonResponse({
        mode: 'raw',
        query: 'q',
        retrieval: 'keyword',
        used_vector: false,
        count: 0,
        items: [],
      }),
    );
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    await sourceSearch(
      { client },
      {
        query: 'q',
        mode: 'raw',
        limit: 5,
        sourceIds: ['11111111-1111-1111-1111-111111111111'],
        kinds: ['github_repo'],
        pathPrefix: 'src/',
      },
    );
    const body = mock.calls[0]!.body as Record<string, unknown>;
    assert.equal(body.limit, 5);
    assert.deepEqual(body.kinds, ['github_repo']);
    assert.equal(body.pathPrefix, 'src/');
  });
});

describe('source_index tool', () => {
  it('posts to /v1/sources with config built from branch and installation id', async () => {
    const mock = mockFetch(() =>
      jsonResponse({
        data: {
          id: 'abc',
          kind: 'github_repo',
          identifier: 'owner/repo',
          display_name: 'owner/repo',
          status: 'pending',
          status_message: 'Index job queued',
          last_indexed_at: null,
          cron_schedule: null,
          index_strategy: 'webhook',
        },
        job: { id: 'job-1', kind: 'index_source', status: 'queued' },
      }),
    );
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    const result = await sourceIndex(
      { client },
      {
        kind: 'github_repo',
        identifier: 'owner/repo',
        branch: 'main',
        githubInstallationId: '12345',
        indexStrategy: 'webhook',
      },
    );
    const body = mock.calls[0]!.body as { config: Record<string, unknown> };
    assert.deepEqual(body.config, { branch: 'main', githubInstallationId: '12345' });
    assert.match(result.content[0]!.text, /owner\/repo/);
    assert.match(result.content[0]!.text, /job-1/);
  });
});

describe('source_list tool', () => {
  it('GETs /v1/sources with query params and renders markdown', async () => {
    const mock = mockFetch(() =>
      jsonResponse({
        items: [
          {
            id: 's1',
            kind: 'github_repo',
            identifier: 'owner/repo',
            display_name: 'My Repo',
            status: 'indexed',
            status_message: null,
            last_indexed_at: '2026-05-20T10:00:00.000Z',
            cron_schedule: null,
            index_strategy: 'webhook',
          },
        ],
        total: 1,
        has_more: false,
      }),
    );
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    const result = await sourceList({ client }, { kind: 'github_repo', limit: 10 });
    assert.equal(mock.calls[0]!.method, 'GET');
    assert.equal(mock.calls[0]!.url, 'http://localhost:9999/v1/sources?kind=github_repo&limit=10');
    assert.match(result.content[0]!.text, /My Repo/);
    assert.match(result.content[0]!.text, /last indexed:/);
  });
});

describe('memory tools', () => {
  it('memory_save POSTs to /v1/memories and confirms the id', async () => {
    const mock = mockFetch(() =>
      jsonResponse({
        data: {
          id: 'mem-1',
          kind: 'fact',
          title: 'Important',
          summary: 'something',
          body: 'body',
          tags: ['x'],
          created_at: '2026-05-20T00:00:00.000Z',
          expires_at: null,
        },
      }),
    );
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    const result = await memorySave(
      { client },
      { kind: 'fact', title: 'Important', summary: 'something', body: 'body' },
    );
    assert.equal(mock.calls[0]!.method, 'POST');
    assert.equal(mock.calls[0]!.url, 'http://localhost:9999/v1/memories');
    assert.match(result.content[0]!.text, /mem-1/);
  });

  it('memory_search hits /v1/memories/semantic-search when semantic=true', async () => {
    const mock = mockFetch(() => jsonResponse({ items: [], total: 0, has_more: false }));
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    await memorySearch({ client }, { query: 'q', semantic: true });
    assert.equal(mock.calls[0]!.url, 'http://localhost:9999/v1/memories/semantic-search');
  });

  it('memory_search hits /v1/memories/search when semantic=false', async () => {
    const mock = mockFetch(() => jsonResponse({ items: [], total: 0, has_more: false }));
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    await memorySearch({ client }, { query: 'q', semantic: false });
    assert.equal(mock.calls[0]!.url, 'http://localhost:9999/v1/memories/search');
  });

  it('memory_retrieve GETs by id and includes ?include=lineage when requested', async () => {
    const mock = mockFetch(() =>
      jsonResponse({
        data: {
          id: 'mem-2',
          kind: 'fact',
          title: 't',
          summary: 's',
          body: 'b',
          created_at: '2026-05-20T00:00:00.000Z',
        },
      }),
    );
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    await memoryRetrieve(
      { client },
      { id: '00000000-0000-0000-0000-000000000001', includeLineage: true },
    );
    assert.equal(
      mock.calls[0]!.url,
      'http://localhost:9999/v1/memories/00000000-0000-0000-0000-000000000001?include=lineage',
    );
  });
});

describe('client error mapping', () => {
  it('throws MnemisApiException carrying code and status from the API error body', async () => {
    const mock = mockFetch(
      () =>
        new Response(JSON.stringify({ error: 'forbidden', message: 'Missing scope' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = createMnemisClient(CONFIG, { fetch: mock.fetch });
    await assert.rejects(
      sourceList({ client }, {}),
      (err: Error & { status?: number; code?: string }) => {
        assert.equal(err.name, 'MnemisApiException');
        assert.equal(err.status, 403);
        assert.equal(err.code, 'forbidden');
        assert.match(err.message, /Missing scope/);
        return true;
      },
    );
  });
});
