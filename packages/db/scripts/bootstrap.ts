/**
 * Bootstrap a workspace + initial API key.
 *
 * Usage:
 *   bun run packages/db/scripts/bootstrap.ts \
 *     --email you@example.com --workspace personal --key-name "local-dev"
 *
 * Prints the raw API key ONCE. We only persist sha256(key); losing it means
 * issuing a new one. The full key has the form `mn_<32-hex>` so users can
 * recognise it in the wild.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import {
  apiKeyHash,
  apiKeyPrefix,
  apiKeys,
  createDatabase,
  users,
  workspaces,
} from '../src/index.ts';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    workspace: { type: 'string' },
    'key-name': { type: 'string' },
  },
});

const email = values.email ?? 'admin@mnemis.local';
const slug = (values.workspace ?? 'default').toLowerCase().replace(/[^a-z0-9-]/g, '-');
const keyName = values['key-name'] ?? 'bootstrap';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const db = createDatabase({ url });

async function ensureUser(): Promise<string> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await db
    .insert(users)
    .values({ email, name: email.split('@')[0] })
    .returning({ id: users.id });
  return created!.id;
}

async function ensureWorkspace(ownerId: string): Promise<string> {
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await db
    .insert(workspaces)
    .values({ slug, name: slug, ownerId })
    .returning({ id: workspaces.id });
  return created!.id;
}

function generateKey(): { raw: string; hash: string; prefix: string } {
  const raw = `mn_${randomBytes(24).toString('hex')}`;
  const hash = apiKeyHash(raw, process.env.INTERNAL_AUTH_SECRET);
  const prefix = apiKeyPrefix(raw);
  return { raw, hash, prefix };
}

try {
  const userId = await ensureUser();
  const workspaceId = await ensureWorkspace(userId);
  const { raw, hash, prefix } = generateKey();
  await db.insert(apiKeys).values({
    workspaceId,
    name: keyName,
    keyHash: hash,
    prefix,
    scopes: ['memories:*', 'sources:*', 'search:*', 'admin:*'],
  });

  console.log('');
  console.log('  workspace.id   =', workspaceId);
  console.log('  workspace.slug =', slug);
  console.log('  user.email     =', email);
  console.log('');
  console.log('  API KEY (save it now — only shown once):');
  console.log(`  ${raw}`);
  console.log('');
  console.log(`  Try:  curl -H "Authorization: Bearer ${raw}" http://localhost:8787/v1/memories`);
  console.log('');
} catch (err) {
  console.error('bootstrap failed:', err);
  process.exit(1);
} finally {
  // postgres.js holds connections — exit explicitly
  process.exit(0);
}
