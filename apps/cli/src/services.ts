import { type MnemisClient, createMnemisClient } from '@mnemis/sdk';
import { readCredentials } from './credentials.ts';

export interface CliServices {
  client(): Promise<MnemisClient>;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
}

export class NotAuthenticatedError extends Error {
  constructor(message = "Not authenticated. Run 'mnemis auth login' first.") {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

export function createServices(
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {},
): CliServices {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? fetch;
  let cached: MnemisClient | null = null;
  return {
    env,
    fetch: fetcher,
    async client() {
      if (cached) return cached;
      const credentials = await readCredentials(env);
      if (!credentials) throw new NotAuthenticatedError();
      cached = createMnemisClient({
        apiUrl: credentials.api_url,
        apiKey: credentials.api_key,
        fetch: fetcher,
      });
      return cached;
    },
  };
}
