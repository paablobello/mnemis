import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface McpClientTarget {
  /** Human-readable name shown in CLI output. */
  name: string;
  /** Absolute path to the config file the client reads. */
  path: string;
  /**
   * Optional schema variant when the client uses a non-standard key
   * (Zed nests servers under `context_servers`).
   */
  serversKey?: string;
}

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClientConfigEnv {
  HOME?: string;
  XDG_CONFIG_HOME?: string;
  APPDATA?: string;
}

function home(env: ClientConfigEnv): string {
  return env.HOME ?? homedir();
}

function configRoot(env: ClientConfigEnv): string {
  if (env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0) return env.XDG_CONFIG_HOME;
  return join(home(env), '.config');
}

export function defaultMcpTargets(env: ClientConfigEnv = process.env): McpClientTarget[] {
  return [
    {
      name: 'Claude Code',
      path: join(home(env), '.claude', 'settings.json'),
    },
    {
      name: 'Cursor',
      path: join(home(env), '.cursor', 'mcp.json'),
    },
    {
      name: 'Windsurf',
      path: join(home(env), '.codeium', 'windsurf', 'mcp_config.json'),
    },
    {
      name: 'Zed',
      path: join(configRoot(env), 'zed', 'settings.json'),
      serversKey: 'context_servers',
    },
  ];
}

async function readJsonIfExists(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf8');
    if (raw.trim().length === 0) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error(`Existing config at ${path} is not a JSON object`);
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface MnemisMcpEntry {
  apiUrl: string;
  apiKey: string;
  command?: string;
  args?: string[];
}

export function buildMnemisServerEntry(input: MnemisMcpEntry): McpServerEntry {
  return {
    command: input.command ?? 'npx',
    args: input.args ?? ['-y', '@mnemis/mcp@latest'],
    env: {
      MNEMIS_API_URL: input.apiUrl,
      MNEMIS_API_KEY: input.apiKey,
    },
  };
}

export type WriteOutcome =
  | { status: 'created'; path: string }
  | { status: 'updated'; path: string; backup: string }
  | { status: 'unchanged'; path: string };

export async function writeMcpEntry(
  target: McpClientTarget,
  entry: McpServerEntry,
  options: { force?: boolean } = {},
): Promise<WriteOutcome> {
  const serversKey = target.serversKey ?? 'mcpServers';
  const existing = await readJsonIfExists(target.path);
  const existingServers = asRecord(existing?.[serversKey]);

  const current = asRecord(existingServers.mnemis);
  if (!options.force && current.command && Object.keys(current).length > 0) {
    const currentArgs = JSON.stringify(current.args ?? []);
    const newArgs = JSON.stringify(entry.args);
    if (
      current.command === entry.command &&
      currentArgs === newArgs &&
      JSON.stringify(current.env) === JSON.stringify(entry.env)
    ) {
      return { status: 'unchanged', path: target.path };
    }
    if (!options.force) {
      return { status: 'unchanged', path: target.path };
    }
  }

  const merged = {
    ...(existing ?? {}),
    [serversKey]: {
      ...existingServers,
      mnemis: entry,
    },
  };

  await mkdir(dirname(target.path), { recursive: true });
  let backup: string | null = null;
  if (existing !== null) {
    backup = `${target.path}.mnemis.bak`;
    await copyFile(target.path, backup);
  }
  await writeFile(target.path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  return backup
    ? { status: 'updated', path: target.path, backup }
    : { status: 'created', path: target.path };
}
