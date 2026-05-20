import type { McpConfig } from './config.ts';

export interface MnemisApiError {
  status: number;
  code: string;
  message: string;
}

export class MnemisApiException extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MnemisApiException';
    this.status = status;
    this.code = code;
  }
}

export interface MnemisClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

interface ClientOptions {
  fetch?: typeof fetch;
}

export function createMnemisClient(config: McpConfig, options: ClientOptions = {}): MnemisClient {
  const baseUrl = config.MNEMIS_API_URL.replace(/\/+$/, '');
  const fetcher = options.fetch ?? fetch;

  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
      const response = await fetcher(url, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.MNEMIS_API_KEY}`,
          accept: 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const text = await response.text();
      const json = text ? safeJson(text) : null;

      if (!response.ok) {
        const err = (json ?? {}) as Partial<MnemisApiError> & { error?: string };
        throw new MnemisApiException(
          response.status,
          err.code ?? err.error ?? `http_${response.status}`,
          err.message ?? (text.slice(0, 500) || response.statusText),
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
