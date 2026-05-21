import { createDatabase } from '@mnemis/db';

let db: ReturnType<typeof createDatabase> | null = null;

export function getDashboardDb(): ReturnType<typeof createDatabase> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for the Mnemis dashboard');
  db ??= createDatabase({ url });
  return db;
}
