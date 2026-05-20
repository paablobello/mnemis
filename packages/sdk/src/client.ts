import { MnemisApiError } from './errors.ts';
import type {
  ChunkSearchInput,
  ChunkSearchResponse,
  CreateMemoryInput,
  CreateSourceInput,
  GitHubInstallationDto,
  JobDto,
  ListMemoriesQuery,
  ListSourcesQuery,
  MemoryDto,
  MemoryListResponse,
  MemorySearchInput,
  MemorySearchResponse,
  PatchMemoryInput,
  RegisterGitHubInstallationInput,
  SourceDto,
  SourceListResponse,
  SourceStatusDto,
} from './types.ts';

export interface MnemisClientOptions {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

interface RawClient {
  request<T>(options: RequestOptions): Promise<T>;
}

function buildPath(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.size > 0 ? `${path}?${params.toString()}` : path;
}

function createRawClient(options: MnemisClientOptions): RawClient {
  const baseUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetch ?? fetch;
  return {
    async request<T>({ method, path, body, query }: RequestOptions): Promise<T> {
      const fullPath = buildPath(path, query);
      const url = `${baseUrl}${fullPath.startsWith('/') ? fullPath : `/${fullPath}`}`;
      const response = await fetcher(url, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
          accept: 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const text = await response.text();
      const json = text ? safeJson(text) : null;

      if (!response.ok) {
        const err = (json ?? {}) as { error?: string; code?: string; message?: string };
        throw new MnemisApiError(
          response.status,
          err.code ?? err.error ?? `http_${response.status}`,
          err.message ?? (text.slice(0, 500) || response.statusText),
          json,
        );
      }

      return (json ?? {}) as T;
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function memoryListQuery(query?: ListMemoriesQuery): RequestOptions['query'] {
  if (!query) return undefined;
  return {
    kind: query.kind,
    tag: query.tag,
    directory: query.directory,
    agent_origin: query.agentOrigin,
    q: query.q,
    include_archived: query.includeArchived,
    include_expired: query.includeExpired,
    include: query.include?.join(','),
    limit: query.limit,
    offset: query.offset,
    created_after: query.createdAfter,
    created_before: query.createdBefore,
  };
}

export interface StreamStatusEvent {
  event: 'progress' | 'done';
  data: SourceStatusDto;
}

export interface MnemisClient {
  raw: RawClient;
  memories: {
    create(input: CreateMemoryInput): Promise<MemoryDto>;
    list(query?: ListMemoriesQuery): Promise<MemoryListResponse>;
    get(id: string, options?: { include?: 'lineage' | 'embedding' }): Promise<MemoryDto>;
    patch(id: string, input: PatchMemoryInput): Promise<MemoryDto>;
    remove(id: string, options?: { permanent?: boolean }): Promise<void>;
    search(input: MemorySearchInput): Promise<MemorySearchResponse>;
    semanticSearch(input: MemorySearchInput): Promise<MemorySearchResponse>;
  };
  sources: {
    create(input: CreateSourceInput): Promise<{ data: SourceDto; job: JobDto | null }>;
    list(query?: ListSourcesQuery): Promise<SourceListResponse>;
    get(id: string): Promise<{ data: SourceDto }>;
    status(id: string): Promise<SourceStatusDto>;
    streamStatus(
      id: string,
      onEvent: (event: StreamStatusEvent) => void,
      options?: { signal?: AbortSignal },
    ): Promise<void>;
    reindex(id: string): Promise<{ job: JobDto }>;
  };
  github: {
    listInstallations(): Promise<{ items: GitHubInstallationDto[] }>;
    registerInstallation(
      input: RegisterGitHubInstallationInput,
    ): Promise<{ data: GitHubInstallationDto }>;
  };
  search(input: ChunkSearchInput): Promise<ChunkSearchResponse>;
}

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamStatusEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: while-loop over delimiter scans
    while ((separatorIndex = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const evt = parseSseEvent(raw);
      if (evt) onEvent(evt);
    }
  }
}

function parseSseEvent(raw: string): StreamStatusEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    const data = JSON.parse(dataLines.join('\n')) as SourceStatusDto;
    return { event: event === 'done' ? 'done' : 'progress', data };
  } catch {
    return null;
  }
}

export function createMnemisClient(options: MnemisClientOptions): MnemisClient {
  const raw = createRawClient(options);
  const baseUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetch ?? fetch;

  return {
    raw,
    memories: {
      create(input) {
        return raw
          .request<{ data: MemoryDto }>({ method: 'POST', path: '/v1/memories', body: input })
          .then((r) => r.data);
      },
      list(query) {
        return raw.request<MemoryListResponse>({
          method: 'GET',
          path: '/v1/memories',
          query: memoryListQuery(query),
        });
      },
      get(id, options) {
        return raw
          .request<{ data: MemoryDto }>({
            method: 'GET',
            path: `/v1/memories/${encodeURIComponent(id)}`,
            query: options?.include ? { include: options.include } : undefined,
          })
          .then((r) => r.data);
      },
      patch(id, input) {
        return raw
          .request<{ data: MemoryDto }>({
            method: 'PATCH',
            path: `/v1/memories/${encodeURIComponent(id)}`,
            body: input,
          })
          .then((r) => r.data);
      },
      async remove(id, options) {
        await raw.request<unknown>({
          method: 'DELETE',
          path: `/v1/memories/${encodeURIComponent(id)}`,
          query: options?.permanent ? { permanent: true } : undefined,
        });
      },
      search(input) {
        return raw.request<MemorySearchResponse>({
          method: 'POST',
          path: '/v1/memories/search',
          body: input,
        });
      },
      semanticSearch(input) {
        return raw.request<MemorySearchResponse>({
          method: 'POST',
          path: '/v1/memories/semantic-search',
          body: input,
        });
      },
    },
    sources: {
      create(input) {
        return raw.request<{ data: SourceDto; job: JobDto | null }>({
          method: 'POST',
          path: '/v1/sources',
          body: input,
        });
      },
      list(query) {
        return raw.request<SourceListResponse>({
          method: 'GET',
          path: '/v1/sources',
          query: query as Record<string, string | number | boolean | undefined | null>,
        });
      },
      get(id) {
        return raw.request<{ data: SourceDto }>({
          method: 'GET',
          path: `/v1/sources/${encodeURIComponent(id)}`,
        });
      },
      status(id) {
        return raw.request<SourceStatusDto>({
          method: 'GET',
          path: `/v1/sources/${encodeURIComponent(id)}/status`,
        });
      },
      async streamStatus(id, onEvent, opts = {}) {
        const url = `${baseUrl}/v1/sources/${encodeURIComponent(id)}/status/stream`;
        const response = await fetcher(url, {
          method: 'GET',
          headers: {
            accept: 'text/event-stream',
            authorization: `Bearer ${options.apiKey}`,
          },
          signal: opts.signal,
        });
        if (!response.ok || !response.body) {
          const text = await response.text().catch(() => '');
          throw new MnemisApiError(
            response.status,
            `http_${response.status}`,
            text.slice(0, 500) || response.statusText,
          );
        }
        await consumeSseStream(response.body, onEvent);
      },
      reindex(id) {
        return raw.request<{ job: JobDto }>({
          method: 'POST',
          path: `/v1/sources/${encodeURIComponent(id)}/reindex`,
        });
      },
    },
    github: {
      listInstallations() {
        return raw.request<{ items: GitHubInstallationDto[] }>({
          method: 'GET',
          path: '/v1/github/installations',
        });
      },
      registerInstallation(input) {
        return raw.request<{ data: GitHubInstallationDto }>({
          method: 'POST',
          path: '/v1/github/installations',
          body: input,
        });
      },
    },
    search(input) {
      return raw.request<ChunkSearchResponse>({
        method: 'POST',
        path: '/v1/search',
        body: input,
      });
    },
  };
}
