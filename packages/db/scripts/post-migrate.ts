/**
 * Runs idempotent SQL files in `migrations/post/` after `drizzle-kit push`.
 *
 * Drizzle does not understand triggers / generated columns — these live in
 * .sql files we replay every time. Each script must be safe to run repeatedly.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dir = join(root, 'migrations', 'post');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.log('post-migrate: no scripts to run');
    process.exit(0);
  }

  for (const file of files) {
    const path = join(dir, file);
    const body = await readFile(path, 'utf8');
    process.stdout.write(`post-migrate: applying ${file} ... `);
    await sql.unsafe(body);
    console.log('ok');
  }
} catch (err) {
  console.error('post-migrate failed:', err);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
