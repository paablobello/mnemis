import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { loadEnv } from './env.ts';
import { health } from './routes/health.ts';

const env = loadEnv();
const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders());

app.get('/', (c) =>
  c.json({
    name: 'mnemis-api',
    version: process.env.MNEMIS_VERSION ?? '0.0.0',
    docs: 'https://github.com/<org>/mnemis',
  }),
);

app.route('/health', health);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('unhandled error', err);
  return c.json(
    { error: 'internal_error', message: err.message },
    500,
  );
});

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
