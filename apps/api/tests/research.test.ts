import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { apiKeys, createDatabase, eq, jobs, researchRuns, users, workspaces } from '@mnemis/db';
import { createApp } from '../src/app.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required for integration tests');

if (!process.env.INTERNAL_AUTH_SECRET) process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const db = createDatabase({ url });
const app = createApp({ silent: true });

const TEST_SLUG = `research-${randomBytes(4).toString('hex')}`;
const RAW_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const KEY_HASH = createHash('sha256').update(RAW_KEY).digest('hex');
const READ_KEY = `mn_test_${randomBytes(20).toString('hex')}`;
const READ_HASH = createHash('sha256').update(READ_KEY).digest('hex');

let workspaceId = '';
let userId = '';

const headersFor = (key: string) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${key}`,
});

before(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: `${TEST_SLUG}@mnemis.test`, name: TEST_SLUG })
    .returning({ id: users.id });
  userId = user!.id;

  const [ws] = await db
    .insert(workspaces)
    .values({ slug: TEST_SLUG, name: TEST_SLUG, ownerId: userId })
    .returning({ id: workspaces.id });
  workspaceId = ws!.id;

  await db.insert(apiKeys).values({
    workspaceId,
    name: 'research-write',
    keyHash: KEY_HASH,
    prefix: RAW_KEY.slice(0, 11),
    scopes: ['sources:*'],
  });
  await db.insert(apiKeys).values({
    workspaceId,
    name: 'research-read',
    keyHash: READ_HASH,
    prefix: READ_KEY.slice(0, 11),
    scopes: ['research:read'],
  });
});

after(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('research API', () => {
  let runId = '';

  it('creates a research run and queues a worker job', async () => {
    const res = await app.request('/v1/research/runs', {
      method: 'POST',
      headers: headersFor(RAW_KEY),
      body: JSON.stringify({
        query: 'state of the art retrieval agents',
        depth: 'quick',
        maxSources: 3,
        includeWeb: false,
        includePapers: false,
        urls: ['https://example.com/research'],
      }),
    });
    assert.equal(res.status, 202);
    const json = await res.json();
    runId = json.data.id;
    assert.equal(json.data.status, 'queued');
    assert.equal(json.data.depth, 'quick');
    assert.equal(json.job.kind, 'research_run');
    assert.equal(json.job.payload.research_run_id, runId);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, json.job.id)).limit(1);
    assert.equal(job!.kind, 'research_run');
    assert.equal((job!.payload as { research_run_id?: string }).research_run_id, runId);
  });

  it('lists and retrieves research runs', async () => {
    const list = await app.request('/v1/research/runs?status=queued', {
      headers: headersFor(READ_KEY),
    });
    assert.equal(list.status, 200);
    const listJson = await list.json();
    assert.ok(listJson.items.some((item: { id: string }) => item.id === runId));

    const get = await app.request(`/v1/research/runs/${runId}`, { headers: headersFor(READ_KEY) });
    assert.equal(get.status, 200);
    const getJson = await get.json();
    assert.equal(getJson.data.id, runId);
  });

  it('validates that a discovery source is configured', async () => {
    const res = await app.request('/v1/research/runs', {
      method: 'POST',
      headers: headersFor(RAW_KEY),
      body: JSON.stringify({
        query: 'no discovery',
        includeWeb: false,
        includePapers: false,
        urls: [],
      }),
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, 'validation_error');

    const rows = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.workspaceId, workspaceId));
    assert.ok(rows.length >= 1);
  });
});
