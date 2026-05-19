import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { detectLanguage } from './language.ts';
import type { IndexSourceConfig, LoadedFile } from './types.ts';

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_EXCLUDES = [
  '.git',
  '.hg',
  '.svn',
  '.turbo',
  'coverage',
  'dist',
  'build',
  'node_modules',
  'vendor',
  '.next',
  '.nuxt',
  '.cache',
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Cargo.lock',
  'go.sum',
];

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function normalisePattern(pattern: string): string {
  return pattern.replace(/^\/+/, '').replace(/\/+$/, '');
}

function pathMatchesPrefix(path: string, pattern: string): boolean {
  const p = normalisePattern(pattern);
  return path === p || path.startsWith(`${p}/`);
}

function isExcluded(path: string, config: IndexSourceConfig): boolean {
  const parts = path.split('/');
  if (DEFAULT_EXCLUDES.some((entry) => parts.includes(entry) || path === entry)) return true;
  return (config.excludePaths ?? []).some((pattern) => pathMatchesPrefix(path, pattern));
}

function isIncluded(path: string, config: IndexSourceConfig): boolean {
  const includes = config.includePaths ?? [];
  if (includes.length === 0) return true;
  return includes.some((pattern) => pathMatchesPrefix(path, pattern));
}

function looksBinary(buf: Buffer): boolean {
  if (buf.includes(0)) return true;
  const sample = buf.subarray(0, Math.min(buf.length, 8_000));
  if (sample.length === 0) return false;

  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
  }
  return suspicious / sample.length > 0.1;
}

async function walk(root: string, dir: string, config: IndexSourceConfig): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    const rel = toPosix(relative(root, absolute));

    if (isExcluded(rel, config)) continue;

    if (entry.isDirectory()) {
      files.push(...(await walk(root, absolute, config)));
      continue;
    }
    if (entry.isFile() && isIncluded(rel, config)) {
      files.push(absolute);
    }
  }

  return files;
}

export async function collectLocalFiles(rootPath: string, config: IndexSourceConfig = {}) {
  const root = resolve(rootPath);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`localPath is not a directory: ${rootPath}`);
  }

  const maxFileBytes = config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const paths = await walk(root, root, config);
  const files: LoadedFile[] = [];

  for (const absolutePath of paths.sort()) {
    const fileStat = await stat(absolutePath);
    if (fileStat.size > maxFileBytes) continue;

    const buf = await readFile(absolutePath);
    if (looksBinary(buf)) continue;

    const path = toPosix(relative(root, absolutePath));
    files.push({
      path,
      absolutePath,
      content: buf.toString('utf8'),
      language: detectLanguage(path),
      byteLength: buf.byteLength,
      modifiedAt: fileStat.mtime,
    });
  }

  return files;
}
