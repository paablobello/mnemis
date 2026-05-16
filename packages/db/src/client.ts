import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface CreateDatabaseOptions {
  url: string;
  max?: number;
  idleTimeout?: number;
}

export function createDatabase(opts: CreateDatabaseOptions): Database {
  const client = postgres(opts.url, {
    max: opts.max ?? 10,
    idle_timeout: opts.idleTimeout ?? 20,
    prepare: false,
  });
  return drizzle(client, { schema, casing: 'snake_case' });
}
