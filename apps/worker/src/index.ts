import { createDatabase } from '@mnemis/db';
import { loadEnv } from './env.ts';
import { runWorkerLoop } from './runner.ts';

const env = loadEnv();
const db = createDatabase({ url: env.DATABASE_URL });

console.log('mnemis worker starting');

await runWorkerLoop({
  db,
  pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
  once: env.WORKER_ONCE,
  onError: (err) => {
    console.error('worker loop error', err);
  },
});
