import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const app = createApp();

serve(
  {
    fetch: app.fetch,
    hostname: env.API_HOST,
    port: env.API_PORT,
  },
  ({ address, port }) => {
    console.log(`mnemis api listening on http://${address}:${port}`);
  },
);
