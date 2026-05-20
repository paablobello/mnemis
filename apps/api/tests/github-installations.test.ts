import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { apiKeys, createDatabase, eq, users, workspaces } from '@mnemis/db';
import { createApp } from '../src/app.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required for integration tests');

if (!process.env.INTERNAL_AUTH_SECRET) process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const db = createDatabase({ url });
const app = createApp({ silent: true });

const TEST_SLUG = `github-installs-${randomBytes(4).toString('hex')}`;
const TEST_EMAIL = `${TEST_SLUG}@mnemis.test`;
const RAW_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const KEY_HASH = createHash('sha256').update(RAW_KEY).digest('hex');
const READ_ONLY_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const READ_ONLY_HASH = createHash('sha256').update(READ_ONLY_KEY).digest('hex');
const OTHER_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const OTHER_HASH = createHash('sha256').update(OTHER_KEY).digest('hex');
const INSTALLATION_ID = String(300_000 + randomBytes(4).readUInt32BE(0));
const UNKNOWN_INSTALLATION_ID = String(400_000 + randomBytes(4).readUInt32BE(0));

let workspaceId = '';
let userId = '';
let otherWorkspaceId = '';
let otherUserId = '';

const headersFor = (key: string) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${key}`,
});

const headers = () => headersFor(RAW_KEY);

before(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: TEST_EMAIL, name: TEST_SLUG })
    .returning({ id: users.id });
  userId = user!.id;

  const [ws] = await db
    .insert(workspaces)
    .values({ slug: TEST_SLUG, name: TEST_SLUG, ownerId: userId })
    .returning({ id: workspaces.id });
  workspaceId = ws!.id;

  const otherSlug = `${TEST_SLUG}-other`;
  const [otherUser] = await db
    .insert(users)
    .values({ email: `${otherSlug}@mnemis.test`, name: otherSlug })
    .returning({ id: users.id });
  otherUserId = otherUser!.id;

  const [otherWs] = await db
    .insert(workspaces)
    .values({ slug: otherSlug, name: otherSlug, ownerId: otherUserId })
    .returning({ id: workspaces.id });
  otherWorkspaceId = otherWs!.id;

  await db.insert(apiKeys).values([
    {
      workspaceId,
      name: 'github-installations',
      keyHash: KEY_HASH,
      prefix: RAW_KEY.slice(0, 11),
      scopes: ['sources:*'],
    },
    {
      workspaceId,
      name: 'github-installations-read',
      keyHash: READ_ONLY_HASH,
      prefix: READ_ONLY_KEY.slice(0, 11),
      scopes: ['sources:read'],
    },
    {
      workspaceId: otherWorkspaceId,
      name: 'github-installations-other',
      keyHash: OTHER_HASH,
      prefix: OTHER_KEY.slice(0, 11),
      scopes: ['sources:*'],
    },
  ]);
});

after(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
  await db.delete(users).where(eq(users.id, otherUserId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('GitHub App installations API', () => {
  it('registers, updates and lists installations in the authenticated workspace', async () => {
    const create = await app.request('/v1/github/installations', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        accountLogin: 'OpenAI',
        accountType: 'Organization',
        repositorySelection: 'selected',
        permissions: { contents: 'read', metadata: 'read' },
        events: ['push'],
        installedAt: '2026-05-19T12:00:00.000Z',
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.equal(created.data.workspace_id, workspaceId);
    assert.equal(created.data.installation_id, INSTALLATION_ID);
    assert.equal(created.data.account_login, 'openai');
    assert.deepEqual(created.data.events, ['push']);

    const update = await app.request('/v1/github/installations', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        accountLogin: 'OpenAI-Renamed',
        repositorySelection: 'all',
        permissions: { contents: 'read' },
      }),
    });
    assert.equal(update.status, 201);
    const updated = await update.json();
    assert.equal(updated.data.id, created.data.id);
    assert.equal(updated.data.account_login, 'openai-renamed');
    assert.equal(updated.data.repository_selection, 'all');

    const list = await app.request('/v1/github/installations', {
      headers: headersFor(READ_ONLY_KEY),
    });
    assert.equal(list.status, 200);
    const listJson = await list.json();
    assert.equal(listJson.items.length, 1);
    assert.equal(listJson.items[0].installation_id, INSTALLATION_ID);
  });

  it('does not allow another workspace to claim the same installation', async () => {
    const res = await app.request('/v1/github/installations', {
      method: 'POST',
      headers: headersFor(OTHER_KEY),
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        accountLogin: 'OpenAI',
      }),
    });
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.error, 'github_installation_claimed');
  });

  it('validates source config references to workspace-linked installations', async () => {
    const accepted = await app.request('/v1/sources', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'github_repo',
        identifier: `${TEST_SLUG}/linked-repo`,
        config: { branch: 'main', githubInstallationId: INSTALLATION_ID },
        indexStrategy: 'webhook',
        enqueue: false,
      }),
    });
    assert.equal(accepted.status, 201);
    const acceptedJson = await accepted.json();
    assert.equal(acceptedJson.data.config.githubInstallationLinked, true);
    assert.equal(acceptedJson.data.config.githubInstallationId, undefined);

    const rejected = await app.request('/v1/sources', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        kind: 'github_repo',
        identifier: `${TEST_SLUG}/unknown-installation-repo`,
        config: { branch: 'main', githubInstallationId: UNKNOWN_INSTALLATION_ID },
        indexStrategy: 'webhook',
        enqueue: false,
      }),
    });
    assert.equal(rejected.status, 400);
    const rejectedJson = await rejected.json();
    assert.equal(rejectedJson.error, 'github_installation_not_found');
  });
});
