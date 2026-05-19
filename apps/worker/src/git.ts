import { type SpawnOptionsWithoutStdio, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runGit(args: string[], options: SpawnOptionsWithoutStdio = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += String(data);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`git ${args[0]} failed with code ${code}: ${stderr.slice(0, 1_000)}`));
    });
  });
}

export interface ClonedRepo {
  path: string;
  cleanup: () => Promise<void>;
}

export interface CloneGitHubOptions {
  branch?: string;
  token?: string;
}

export async function cloneGitHubRepo(
  identifier: string,
  options: CloneGitHubOptions = {},
): Promise<ClonedRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'mnemis-repo-'));
  const url = `https://github.com/${identifier}.git`;
  const args = ['clone', '--depth', '1', '--single-branch'];
  if (options.branch) args.push('--branch', options.branch);
  args.push(url, dir);

  // Avoid embedding the token in argv (visible via ps). GIT_CONFIG_* injects
  // an Authorization header for the duration of this clone only.
  const env = options.token
    ? {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraheader',
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${options.token}`).toString('base64')}`,
      }
    : undefined;

  try {
    await runGit(args, env ? { env } : {});
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }

  return {
    path: dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
