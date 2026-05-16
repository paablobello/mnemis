import { createDatabase, type Database } from '@mnemis/db';
import { loadEnv } from './env.ts';

let instance: Database | null = null;

export function getDb(): Database {
  if (instance) return instance;
  const env = loadEnv();
  instance = createDatabase({ url: env.DATABASE_URL });
  return instance;
}
