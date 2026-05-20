import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MnemisApiError, createMnemisClient } from '@mnemis/sdk';
import {
  githubInstallationList,
  githubInstallationRegister,
  memoryDelete,
  memoryList,
  memoryRetrieve,
  memorySave,
  memorySearch,
  memoryUpdate,
  sourceGet,
  sourceIndex,
  sourceList,
  sourceReindex,
  sourceSearch,
  sourceStatus,
} from '../src/tools.ts';

const BASE = 'http://localhost:9999';
const KEY = 'test-key';

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

function ok(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function buildClient(handler: (call: RecordedCall) => Response | Promise<Response>) {
  const mock = mockFetch(handler);
  return {
    client: createMnemisClient({ apiUrl: BASE, apiKey: KEY, fetch: mock.fetch }),
    calls: mock.calls,
  };
}

describe('source_search tool', () => {
  it('calls /v1/search with mode=markdown and returns the markdown body', async () => {
    const { client, calls } = buildClient(() =>
      ok({
        mode: 'markdown',
        query: 'q',
        retrieval: 'hybrid_rrf',
        used_vector: true,
        embedding_model: null,
        embedding_tokens: 0,
        count: 1,
        items: [],
        citations: [],
        markdown: '# Results\n[1] hit',
      }),
    );
    const result = await sourceSearch({ client }, { query: 'how does X work', mode: 'markdown' });
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, `${BASE}/v1/search`);
    assert.equal(calls[0]!.authorization, `Bearer ${KEY}`);
    assert.equal((calls[0]!.body as { mode: string }).mode, 'markdown');
    assert.equal(result.content[0]!.text, '# Results\n[1] hit');
  });

  it('renders synthesized mode with model footer', async () => {
    const { client } = buildClient(() =>
      ok({
        mode: 'synthesized',
        query: 'q',
        retrieval: 'hybrid_rrf',
        used_vector: true,
        embedding_model: null,
        embedding_tokens: 0,
        count: 1,
        items: [],
        citations: [],
        answer: 'It uses contextual prefixes [1].',
        synthesis_model: 'claude-3-5-haiku-latest',
      }),
    );
    const result = await sourceSearch({ client }, { query: 'how', mode: 'synthesized' });
    assert.match(result.content[0]!.text, /\[1\]/);
    assert.match(result.content[0]!.text, /claude-3-5-haiku-latest/);
  });
});

describe('source_index tool', () => {
  it('posts to /v1/sources with config built from branch and installation id', async () => {
    const { client, calls } = buildClient(() =>
      ok({
        data: {
          id: 'abc',
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
        },
        job: {
          id: 'job-1',
          kind: 'index_source',
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
    const result = await sourceIndex(
      { client },
      {
        kind: 'github_repo',
        identifier: 'owner/repo',
        branch: 'main',
        githubInstallationId: '12345',
        indexStrategy: 'webhook',
        cronSchedule: undefined,
      },
    );
    const body = calls[0]!.body as { config: Record<string, unknown> };
    assert.deepEqual(body.config, { branch: 'main', githubInstallationId: '12345' });
    assert.match(result.content[0]!.text, /owner\/repo/);
    assert.match(result.content[0]!.text, /job-1/);
  });
});

describe('source_list tool', () => {
  it('GETs /v1/sources with query params and renders markdown', async () => {
    const { client, calls } = buildClient(() =>
      ok({
        items: [
          {
            id: 's1',
            kind: 'github_repo',
            identifier: 'owner/repo',
            display_name: 'My Repo',
            config: {},
            last_indexed_at: '2026-05-20T10:00:00.000Z',
            last_change_at: null,
            index_strategy: 'webhook',
            cron_schedule: null,
            status: 'indexed',
            status_message: null,
            created_at: '2026-05-20T00:00:00.000Z',
            updated_at: '2026-05-20T00:00:00.000Z',
          },
        ],
        total: 1,
        has_more: false,
      }),
    );
    const result = await sourceList({ client }, { kind: 'github_repo', limit: 10 });
    assert.equal(calls[0]!.method, 'GET');
    assert.equal(calls[0]!.url, `${BASE}/v1/sources?kind=github_repo&limit=10`);
    assert.match(result.content[0]!.text, /My Repo/);
    assert.match(result.content[0]!.text, /last indexed:/);
  });
});

describe('source operational tools', () => {
  it('source_get fetches one source by id', async () => {
    const { client, calls } = buildClient(() =>
      ok({
        data: {
          id: '00000000-0000-0000-0000-000000000001',
          kind: 'github_repo',
          identifier: 'owner/repo',
          display_name: 'owner/repo',
          config: { branch: 'main' },
          last_indexed_at: null,
          last_change_at: null,
          index_strategy: 'webhook',
          cron_schedule: null,
          status: 'indexed',
          status_message: null,
          created_at: '2026-05-20T00:00:00.000Z',
          updated_at: '2026-05-20T00:00:00.000Z',
        },
      }),
    );
    const result = await sourceGet({ client }, { id: '00000000-0000-0000-0000-000000000001' });
    assert.equal(calls[0]!.url, `${BASE}/v1/sources/00000000-0000-0000-0000-000000000001`);
    assert.match(result.content[0]!.text, /"branch": "main"/);
  });

  it('source_status renders latest job and chunk count', async () => {
    const { client, calls } = buildClient(() =>
      ok({
        source: {
          id: '00000000-0000-0000-0000-000000000001',
          kind: 'github_repo',
          identifier: 'owner/repo',
          display_name: 'owner/repo',
          config: {},
          last_indexed_at: '2026-05-20T00:00:00.000Z',
          last_change_at: null,
          index_strategy: 'webhook',
          cron_schedule: null,
          status: 'indexed',
          status_message: null,
          created_at: '2026-05-20T00:00:00.000Z',
          updated_at: '2026-05-20T00:00:00.000Z',
        },
        chunk_count: 7,
        latest_job: {
          id: 'job-1',
          kind: 'index_source',
          status: 'completed',
          payload: {},
          progress: {},
          result: null,
          error: null,
          scheduled_at: '2026-05-20T00:00:00.000Z',
          started_at: null,
          completed_at: null,
          attempts: 1,
        },
      }),
    );
    const result = await sourceStatus({ client }, { id: '00000000-0000-0000-0000-000000000001' });
    assert.equal(calls[0]!.url, `${BASE}/v1/sources/00000000-0000-0000-0000-000000000001/status`);
    assert.match(result.content[0]!.text, /chunks: 7/);
    assert.match(result.content[0]!.text, /job-1/);
  });

  it('source_reindex queues a reindex job', async () => {
    const { client, calls } = buildClient(() =>
      ok({
        job: {
          id: 'job-reindex',
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
    const result = await sourceReindex({ client }, { id: '00000000-0000-0000-0000-000000000001' });
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, `${BASE}/v1/sources/00000000-0000-0000-0000-000000000001/reindex`);
    assert.match(result.content[0]!.text, /job-reindex/);
  });
});

describe('memory tools', () => {
  it('memory_save POSTs to /v1/memories and confirms the id', async () => {
    const { client, calls } = buildClient(() =>
      ok({
        data: {
          id: 'mem-1',
          kind: 'fact',
          title: 'Important',
          summary: 'something',
          body: 'body',
          tags: ['x'],
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
    const result = await memorySave(
      { client },
      { kind: 'fact', title: 'Important', summary: 'something', body: 'body' },
    );
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.url, `${BASE}/v1/memories`);
    assert.match(result.content[0]!.text, /mem-1/);
  });

  it('memory_search hits /v1/memories/semantic-search when semantic=true', async () => {
    const { client, calls } = buildClient(() => ok({ items: [], total: 0, has_more: false }));
    await memorySearch({ client }, { query: 'q', semantic: true });
    assert.equal(calls[0]!.url, `${BASE}/v1/memories/semantic-search`);
  });

  it('memory_search hits /v1/memories/search when semantic=false', async () => {
    const { client, calls } = buildClient(() => ok({ items: [], total: 0, has_more: false }));
    await memorySearch({ client }, { query: 'q', semantic: false });
    assert.equal(calls[0]!.url, `${BASE}/v1/memories/search`);
  });

  it('memory_retrieve GETs by id and includes ?include=lineage when requested', async () => {
    const { client, calls } = buildClient(() =>
      ok({
        data: {
          id: 'mem-2',
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
    await memoryRetrieve(
      { client },
      { id: '00000000-0000-0000-0000-000000000001', includeLineage: true },
    );
    assert.equal(
      calls[0]!.url,
      `${BASE}/v1/memories/00000000-0000-0000-0000-000000000001?include=lineage`,
    );
  });

  it('memory_list GETs /v1/memories with filters', async () => {
    const { client, calls } = buildClient(() => ok({ items: [], total: 0, has_more: false }));
    await memoryList(
      { client },
      {
        kind: 'fact',
        tag: 'phase-4',
        directory: '/repo',
        includeArchived: true,
        includeLineage: true,
        limit: 5,
        offset: 10,
      },
    );
    assert.equal(
      calls[0]!.url,
      `${BASE}/v1/memories?kind=fact&tag=phase-4&directory=%2Frepo&include_archived=true&include=lineage&limit=5&offset=10`,
    );
  });

  it('memory_update PATCHes mutable metadata fields', async () => {
    const { client, calls } = buildClient(() =>
      ok({
        data: {
          id: '00000000-0000-0000-0000-000000000001',
          kind: 'fact',
          title: 't',
          summary: 's',
          body: 'b',
          tags: ['x'],
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
          metadata: { source: 'test' },
          workspace_id: 'ws',
          created_at: '2026-05-20T00:00:00.000Z',
          updated_at: '2026-05-20T00:00:00.000Z',
        },
      }),
    );
    await memoryUpdate(
      { client },
      {
        id: '00000000-0000-0000-0000-000000000001',
        tags: ['x'],
        ttlSeconds: null,
        metadata: { source: 'test' },
      },
    );
    assert.equal(calls[0]!.method, 'PATCH');
    assert.deepEqual(calls[0]!.body, {
      tags: ['x'],
      ttlSeconds: null,
      metadata: { source: 'test' },
    });
  });

  it('memory_delete soft-deletes by default and supports permanent delete', async () => {
    const { client, calls } = buildClient(() => new Response(null, { status: 204 }));
    await memoryDelete({ client }, { id: '00000000-0000-0000-0000-000000000001' });
    await memoryDelete({ client }, { id: '00000000-0000-0000-0000-000000000002', permanent: true });
    assert.equal(calls[0]!.url, `${BASE}/v1/memories/00000000-0000-0000-0000-000000000001`);
    assert.equal(
      calls[1]!.url,
      `${BASE}/v1/memories/00000000-0000-0000-0000-000000000002?permanent=true`,
    );
  });
});

describe('github installation tools', () => {
  it('lists and registers installations', async () => {
    const responses = [
      ok({
        items: [
          {
            id: 'ghi-1',
            workspace_id: 'ws',
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
          },
        ],
      }),
      ok({
        data: {
          id: 'ghi-2',
          workspace_id: 'ws',
          installation_id: '67890',
          account_login: 'new-owner',
          account_type: 'Organization',
          repository_selection: 'selected',
          permissions: {},
          events: ['push'],
          installed_at: '2026-05-20T00:00:00.000Z',
          suspended_at: null,
          deleted_at: null,
          created_at: '2026-05-20T00:00:00.000Z',
          updated_at: '2026-05-20T00:00:00.000Z',
        },
      }),
    ];
    const { client, calls } = buildClient(() => responses.shift()!);
    const list = await githubInstallationList({ client });
    const registered = await githubInstallationRegister(
      { client },
      {
        installationId: '67890',
        accountLogin: 'new-owner',
        accountType: 'Organization',
        repositorySelection: 'selected',
        events: ['push'],
      },
    );
    assert.equal(calls[0]!.url, `${BASE}/v1/github/installations`);
    assert.equal(calls[1]!.method, 'POST');
    assert.deepEqual(calls[1]!.body, {
      installationId: '67890',
      accountLogin: 'new-owner',
      accountType: 'Organization',
      repositorySelection: 'selected',
      events: ['push'],
    });
    assert.match(list.content[0]!.text, /owner/);
    assert.match(registered.content[0]!.text, /new-owner/);
  });
});

describe('client error mapping', () => {
  it('throws MnemisApiError carrying code and status from the API error body', async () => {
    const { client } = buildClient(
      () =>
        new Response(JSON.stringify({ error: 'forbidden', message: 'Missing scope' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await assert.rejects(
      sourceList({ client }, {}),
      (err: Error & { status?: number; code?: string }) => {
        assert.ok(err instanceof MnemisApiError);
        assert.equal(err.status, 403);
        assert.equal(err.code, 'forbidden');
        assert.match(err.message, /Missing scope/);
        return true;
      },
    );
  });
});
