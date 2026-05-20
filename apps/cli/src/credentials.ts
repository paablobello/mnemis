import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Credentials {
  api_url: string;
  api_key: string;
}

function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, 'mnemis');
  return join(env.HOME ?? homedir(), '.config', 'mnemis');
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.MNEMIS_CREDENTIALS_FILE ?? join(configDir(env), 'credentials.json');
}

export async function readCredentials(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Credentials | null> {
  const overrideUrl = env.MNEMIS_API_URL;
  const overrideKey = env.MNEMIS_API_KEY;
  if (overrideUrl && overrideKey) {
    return { api_url: overrideUrl, api_key: overrideKey };
  }

  const file = credentialsPath(env);
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    if (!parsed.api_url || !parsed.api_key) return null;
    return { api_url: parsed.api_url, api_key: parsed.api_key };
  } catch (err) {
    if (isFileNotFound(err)) return null;
    throw err;
  }
}

export async function writeCredentials(
  credentials: Credentials,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const file = credentialsPath(env);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {
    // Filesystems that ignore chmod (eg. some test mounts) are fine.
  });
  return file;
}

export async function clearCredentials(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const file = credentialsPath(env);
  try {
    await rm(file, { force: false });
    return true;
  } catch (err) {
    if (isFileNotFound(err)) return false;
    throw err;
  }
}

function isFileNotFound(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export function maskKey(key: string): string {
  if (key.length <= 11) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 11)}…${key.slice(-4)}`;
}
