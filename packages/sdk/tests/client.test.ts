import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MnemisApiError, createMnemisClient } from '../src/index.ts';

interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
  authorization: string;
}

function mockFetch(handler: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? undefined);
    calls.push({
      method: String(init?.method ?? 'GET'),
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      authorization: headers.get('authorization') ?? '',
    });
    return handler(calls[calls.length - 1]!);
  };
  return { fetch: fakeFetch, calls };
}

function ok(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const BASE = 'http://api.test';
const KEY = 'mn_test_key';

function client(handler: (call: RecordedCall) => Response | Promise<Response>) {
  const mock = mockFetch(handler);
  return {
    client: createMnemisClient({ apiUrl: BASE, apiKey: KEY, fetch: mock.fetch }),
    calls: mock.calls,
  };
}

describe('memories resource', () => {
  it('create POSTs to /v1/memories and returns data', async () => {
    const { client: c, calls } = client(() =>
      ok({
        data: {
          id: 'mem-1',
          kind: 'fact',
          title: 't',
          summary: 's',
          body: 'b',
          tags: [],
          directory: null,
          file_overlap: [],
          agent_origin: null,
          ttl_seconds: null,
          expires_at: null,
          archived_at: null,
          source_ids: [],
          derived_from: null,
          confidence: null,
          tool_calls: [],
          model_version: null,
          edited_files: [],
          metadata: {},
          workspace_id: 'ws-1',
          created_at: '2026-05-20T00:00:00.000Z',
          updated_at: '2026-05-20T00:00:00.000Z',
        },
      }),
    );
    const created = await c.memories.create({ kind: 'fact', title: 't', summary: 's', body: 'b' });
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, `${BASE}/v1/memories`);
    assert.equal(calls[0]!.authorization, `Bearer ${KEY}`);
    assert.equal(created.id, 'mem-1');
  });

  it('search and semanticSearch hit distinct paths', async () => {
    const responses = [
      { query: 'q', mode: 'keyword', items: [], count: 0 },
      {
        query: 'q',
        mode: 'hybrid_rrf',
        embedding_model: null,
        embedding_tokens: 0,
        reranked: false,
        reranker_model: null,
        reranker_tokens: 0,
        items: [],
        count: 0,
      },
    ];
    const { client: c, calls } = client(() => ok(responses.shift()));
    await c.memories.search({ query: 'q' });
    await c.memories.semanticSearch({ query: 'q' });
    assert.equal(calls[0]!.url, `${BASE}/v1/memories/search`);
    assert.equal(calls[1]!.url, `${BASE}/v1/memories/semantic-search`);
  });

  it('get supports include=lineage as query param', async () => {
    const { client: c, calls } = client(() =>
      ok({
        data: {
          id: 'm',
          kind: 'fact',
          title: 't',
          summary: 's',
          body: 'b',
          tags: [],
          directory: null,
          file_overlap: [],
          agent_origin: null,
          ttl_seconds: null,
          expires_at: null,
          archived_at: null,
          source_ids: [],
          derived_from: null,
          confidence: null,
          tool_calls: [],
          model_version: null,
          edited_files: [],
          metadata: {},
          workspace_id: 'ws',
          created_at: '2026-05-20T00:00:00.000Z',
          updated_at: '2026-05-20T00:00:00.000Z',
        },
      }),
    );
    await c.memories.get('abc', { include: 'lineage' });
    assert.equal(calls[0]!.url, `${BASE}/v1/memories/abc?include=lineage`);
  });

  it('list maps friendly query keys to API query params', async () => {
    const { client: c, calls } = client(() => ok({ items: [], total: 0, has_more: false }));
    await c.memories.list({
      kind: 'fact',
      tag: 'phase-4',
      directory: '/repo',
      agentOrigin: 'cli',
      q: 'index',
      includeArchived: true,
      includeExpired: false,
      include: ['lineage'],
      limit: 5,
      offset: 10,
      createdAfter: '2026-05-20T00:00:00.000Z',
      createdBefore: '2026-05-21T00:00:00.000Z',
    });
    assert.equal(
      calls[0]!.url,
      `${BASE}/v1/memories?kind=fact&tag=phase-4&directory=%2Frepo&agent_origin=cli&q=index&include_archived=true&include_expired=false&include=lineage&limit=5&offset=10&created_after=2026-05-20T00%3A00%3A00.000Z&created_before=2026-05-21T00%3A00%3A00.000Z`,
    );
  });

  it('remove can request permanent deletion', async () => {
    const { client: c, calls } = client(() => new Response(null, { status: 204 }));
    await c.memories.remove('mem-1', { permanent: true });
    assert.equal(calls[0]!.method, 'DELETE');
    assert.equal(calls[0]!.url, `${BASE}/v1/memories/mem-1?permanent=true`);
  });
});

describe('sources resource', () => {
  it('list builds query string from filters', async () => {
    const { client: c, calls } = client(() => ok({ items: [], total: 0, has_more: false }));
    await c.sources.list({ kind: 'github_repo', limit: 5 });
    assert.equal(calls[0]!.method, 'GET');
    assert.equal(calls[0]!.url, `${BASE}/v1/sources?kind=github_repo&limit=5`);
  });

  it('create POSTs with config and enqueue defaults', async () => {
    const { client: c, calls } = client(() =>
      ok({
        data: {
          id: 's',
          kind: 'github_repo',
          identifier: 'o/r',
          display_name: 'o/r',
          config: {},
          last_indexed_at: null,
          last_change_at: null,
          index_strategy: 'webhook',
          cron_schedule: null,
          status: 'pending',
          status_message: null,
          created_at: '2026-05-20T00:00:00.000Z',
          updated_at: '2026-05-20T00:00:00.000Z',
        },
        job: null,
      }),
    );
    await c.sources.create({
      kind: 'github_repo',
      identifier: 'o/r',
      config: { branch: 'main', githubInstallationId: '12345' },
      indexStrategy: 'webhook',
    });
    const body = calls[0]!.body as { config: { branch: string }; indexStrategy: string };
    assert.equal(body.config.branch, 'main');
    assert.equal(body.indexStrategy, 'webhook');
  });

  it('reindex POSTs to the dedicated endpoint', async () => {
    const { client: c, calls } = client(() =>
      ok({
        job: {
          id: 'j',
          kind: 'reindex_source',
          status: 'queued',
          payload: {},
          progress: {},
          result: null,
          error: null,
          scheduled_at: '2026-05-20T00:00:00.000Z',
          started_at: null,
          completed_at: null,
          attempts: 0,
        },
      }),
    );
    await c.sources.reindex('src-1');
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, `${BASE}/v1/sources/src-1/reindex`);
  });
});

describe('search', () => {
  it('POSTs /v1/search with the input body and parses markdown', async () => {
    const { client: c, calls } = client(() =>
      ok({
        mode: 'markdown',
        query: 'q',
        retrieval: 'hybrid_rrf',
        used_vector: true,
        embedding_model: 'voyage-3.5-large',
        embedding_tokens: 4,
        reranked: false,
        reranker_model: null,
        reranker_tokens: 0,
        items: [],
        citations: [],
        count: 0,
        markdown: '# Results',
      }),
    );
    const res = await c.search({ query: 'q', mode: 'markdown', limit: 3 });
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, `${BASE}/v1/search`);
    assert.equal(res.markdown, '# Results');
  });
});

describe('github', () => {
  it('listInstallations GETs the right path', async () => {
    const { client: c, calls } = client(() => ok({ items: [] }));
    await c.github.listInstallations();
    assert.equal(calls[0]!.method, 'GET');
    assert.equal(calls[0]!.url, `${BASE}/v1/github/installations`);
  });
});

describe('error mapping', () => {
  it('wraps non-2xx responses in MnemisApiError', async () => {
    const { client: c } = client(
      () =>
        new Response(JSON.stringify({ error: 'validation_error', message: 'bad input' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await assert.rejects(
      c.memories.create({ kind: 'fact', title: '', summary: '', body: '' }),
      (err: Error) => {
        assert.ok(err instanceof MnemisApiError);
        assert.equal(err.status, 400);
        assert.equal(err.code, 'validation_error');
        return true;
      },
    );
  });
});
