import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
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

export async function clonePublicGitHubRepo(
  identifier: string,
  branch?: string,
): Promise<ClonedRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'mnemis-repo-'));
  const url = `https://github.com/${identifier}.git`;
  const args = ['clone', '--depth', '1', '--single-branch'];
  if (branch) args.push('--branch', branch);
  args.push(url, dir);

  try {
    await runGit(args);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }

  return {
    path: dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
