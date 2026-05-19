import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import {
  and,
  createDatabase,
  eq,
  githubAppInstallations,
  jobs,
  sources,
  sql,
  users,
  workspaces,
} from '@mnemis/db';
import { createApp } from '../src/app.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required for integration tests');

if (!process.env.INTERNAL_AUTH_SECRET) process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const db = createDatabase({ url });
const app = createApp({ silent: true });

const TEST_SLUG = `github-hooks-${randomBytes(4).toString('hex')}`;
const TEST_EMAIL = `${TEST_SLUG}@mnemis.test`;
const WEBHOOK_REPO = `${TEST_SLUG}/mnemis-test`;
const MANUAL_REPO = `${TEST_SLUG}/manual-repo`;
const DEV_REPO = `${TEST_SLUG}/dev-repo`;
const INSTALLATION_ID = String(100_000 + randomBytes(4).readUInt32BE(0));
const OTHER_INSTALLATION_ID = String(200_000 + randomBytes(4).readUInt32BE(0));
const SECRET = `ghs_${randomBytes(16).toString('hex')}`;
const ORIGINAL_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

let workspaceId = '';
let userId = '';
let otherWorkspaceId = '';
let otherUserId = '';
let otherWorkspaceSourceId = '';
let webhookSourceId = '';
let manualSourceId = '';
let branchSourceId = '';

function setSecret(): void {
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
}

function restoreSecret(): void {
  if (ORIGINAL_SECRET === undefined) {
    Reflect.deleteProperty(process.env, 'GITHUB_WEBHOOK_SECRET');
  } else {
    process.env.GITHUB_WEBHOOK_SECRET = ORIGINAL_SECRET;
  }
}

function sign(rawBody: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function pushPayload(
  input: {
    repo?: string;
    ref?: string;
    timestamp?: string;
    installationId?: string | null;
  } = {},
) {
  const payload: Record<string, unknown> = {
    ref: input.ref ?? 'refs/heads/main',
    after: 'abc123',
    repository: {
      full_name: input.repo ?? WEBHOOK_REPO,
      default_branch: 'main',
    },
    head_commit: {
      id: 'abc123',
      timestamp: input.timestamp ?? '2026-05-19T12:34:56.000Z',
    },
  };

  if (input.installationId !== null) {
    payload.installation = { id: Number(input.installationId ?? INSTALLATION_ID) };
  }

  return payload;
}

async function githubRequest(input: {
  event: string;
  payload: unknown;
  delivery?: string;
  signature?: string;
}) {
  const raw = JSON.stringify(input.payload);
  return app.request('/v1/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': input.event,
      'x-github-delivery': input.delivery ?? `delivery-${randomBytes(4).toString('hex')}`,
      'x-hub-signature-256': input.signature ?? sign(raw),
    },
    body: raw,
  });
}

before(async () => {
  setSecret();

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

  const [otherUser] = await db
    .insert(users)
    .values({ email: `other-${TEST_EMAIL}`, name: `other-${TEST_SLUG}` })
    .returning({ id: users.id });
  otherUserId = otherUser!.id;

  const [otherWs] = await db
    .insert(workspaces)
    .values({ slug: `other-${TEST_SLUG}`, name: `other-${TEST_SLUG}`, ownerId: otherUserId })
    .returning({ id: workspaces.id });
  otherWorkspaceId = otherWs!.id;

  await db.insert(githubAppInstallations).values([
    {
      workspaceId,
      installationId: INSTALLATION_ID,
      accountLogin: TEST_SLUG,
      accountType: 'Organization',
      repositorySelection: 'selected',
      permissions: { contents: 'read', metadata: 'read' },
      events: ['push'],
    },
    {
      workspaceId: otherWorkspaceId,
      installationId: OTHER_INSTALLATION_ID,
      accountLogin: `other-${TEST_SLUG}`,
      accountType: 'Organization',
      repositorySelection: 'selected',
      permissions: { contents: 'read', metadata: 'read' },
      events: ['push'],
    },
  ]);

  const inserted = await db
    .insert(sources)
    .values([
      {
        workspaceId,
        kind: 'github_repo',
        identifier: WEBHOOK_REPO,
        displayName: 'webhook repo',
        config: { branch: 'main', githubInstallationId: INSTALLATION_ID },
        indexStrategy: 'webhook',
        status: 'indexed',
      },
      {
        workspaceId,
        kind: 'github_repo',
        identifier: MANUAL_REPO,
        displayName: 'manual repo',
        config: { branch: 'main' },
        indexStrategy: 'manual',
        status: 'indexed',
      },
      {
        workspaceId,
        kind: 'github_repo',
        identifier: DEV_REPO,
        displayName: 'dev repo',
        config: { branch: 'dev', githubInstallationId: INSTALLATION_ID },
        indexStrategy: 'webhook',
        status: 'indexed',
      },
      {
        workspaceId: otherWorkspaceId,
        kind: 'github_repo',
        identifier: WEBHOOK_REPO,
        displayName: 'other workspace same repo',
        config: { branch: 'main', githubInstallationId: OTHER_INSTALLATION_ID },
        indexStrategy: 'webhook',
        status: 'indexed',
      },
    ])
    .returning({ id: sources.id, displayName: sources.displayName });

  webhookSourceId = inserted.find((row) => row.displayName === 'webhook repo')!.id;
  manualSourceId = inserted.find((row) => row.displayName === 'manual repo')!.id;
  branchSourceId = inserted.find((row) => row.displayName === 'dev repo')!.id;
  otherWorkspaceSourceId = inserted.find(
    (row) => row.displayName === 'other workspace same repo',
  )!.id;
});

after(async () => {
  restoreSecret();
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
});

describe('GitHub webhooks', () => {
  it('is mounted before API-key auth and handles ping with a valid signature', async () => {
    const res = await githubRequest({ event: 'ping', payload: { zen: 'fast context' } });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.event, 'ping');
  });

  it('rejects invalid signatures before parsing event payloads', async () => {
    const res = await githubRequest({
      event: 'push',
      payload: pushPayload(),
      signature: 'sha256=bad',
    });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error, 'unauthorized');
  });

  it('fails closed when the GitHub webhook secret is not configured', async () => {
    Reflect.deleteProperty(process.env, 'GITHUB_WEBHOOK_SECRET');
    const res = await githubRequest({ event: 'ping', payload: { zen: 'missing secret' } });
    assert.equal(res.status, 424);
    const json = await res.json();
    assert.equal(json.error, 'github_webhook_secret_missing');
    setSecret();
  });

  it('ignores unsupported events after signature verification', async () => {
    const res = await githubRequest({ event: 'issues', payload: { action: 'opened' } });
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.equal(json.ignored, true);
    assert.equal(json.reason, 'unsupported_event');
  });

  it('queues reindex jobs for matching webhook sources on push', async () => {
    const delivery = `push-${randomBytes(4).toString('hex')}`;
    const res = await githubRequest({
      event: 'push',
      delivery,
      payload: pushPayload(),
    });
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.equal(json.repository, WEBHOOK_REPO);
    assert.equal(json.branch, 'main');
    assert.equal(json.installation_id, INSTALLATION_ID);
    assert.equal(json.matched_installations, 1);
    assert.equal(json.matched_sources, 1);
    assert.equal(json.jobs_created, 1);
    assert.equal(json.skipped_branch, 0);
    assert.equal(json.duplicate_deliveries, 0);
    assert.equal(json.jobs.length, 1);

    const [updatedWebhookSource] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, webhookSourceId))
      .limit(1);
    assert.equal(updatedWebhookSource!.status, 'pending');
    assert.equal(updatedWebhookSource!.statusMessage, 'GitHub push webhook queued reindex');
    assert.equal(updatedWebhookSource!.lastChangeAt?.toISOString(), '2026-05-19T12:34:56.000Z');

    const [manualSource] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, manualSourceId))
      .limit(1);
    assert.equal(manualSource!.status, 'indexed');

    const [branchSource] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, branchSourceId))
      .limit(1);
    assert.equal(branchSource!.status, 'indexed');

    const [otherWorkspaceSource] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, otherWorkspaceSourceId))
      .limit(1);
    assert.equal(otherWorkspaceSource!.status, 'indexed');

    const queued = await db.select().from(jobs).where(eq(jobs.id, json.jobs[0].id)).limit(1);
    assert.equal(queued[0]!.kind, 'reindex_source');
    assert.equal((queued[0]!.payload as { source_id?: string }).source_id, webhookSourceId);
    assert.equal((queued[0]!.payload as { github_delivery?: string }).github_delivery, delivery);
    assert.equal((queued[0]!.payload as { github_branch?: string }).github_branch, 'main');
    assert.equal(
      (queued[0]!.payload as { github_installation_id?: string }).github_installation_id,
      INSTALLATION_ID,
    );
  });

  it('does not enqueue duplicate jobs for the same GitHub delivery', async () => {
    const delivery = `dup-${randomBytes(4).toString('hex')}`;
    const first = await githubRequest({ event: 'push', delivery, payload: pushPayload() });
    assert.equal(first.status, 202);
    const firstJson = await first.json();
    assert.equal(firstJson.jobs_created, 1);

    const second = await githubRequest({ event: 'push', delivery, payload: pushPayload() });
    assert.equal(second.status, 202);
    const secondJson = await second.json();
    assert.equal(secondJson.jobs_created, 0);
    assert.equal(secondJson.duplicate_deliveries, 1);
  });

  it('serializes concurrent retries for the same GitHub delivery', async () => {
    const delivery = `concurrent-${randomBytes(4).toString('hex')}`;
    const [first, second] = await Promise.all([
      githubRequest({ event: 'push', delivery, payload: pushPayload() }),
      githubRequest({ event: 'push', delivery, payload: pushPayload() }),
    ]);
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);

    const firstJson = await first.json();
    const secondJson = await second.json();
    assert.equal(firstJson.jobs_created + secondJson.jobs_created, 1);
    assert.equal(firstJson.duplicate_deliveries + secondJson.duplicate_deliveries, 1);

    const [count] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, workspaceId),
          sql`${jobs.payload}->>'source_id' = ${webhookSourceId}`,
          sql`${jobs.payload}->>'github_delivery' = ${delivery}`,
        ),
      );
    assert.equal(count!.count, 1);
  });

  it('does not enqueue when no webhook source matches the pushed repo, strategy, or branch', async () => {
    const missingInstallation = await githubRequest({
      event: 'push',
      payload: pushPayload({ installationId: null }),
    });
    assert.equal(missingInstallation.status, 202);
    const missingInstallationJson = await missingInstallation.json();
    assert.equal(missingInstallationJson.ignored_reason, 'missing_installation');
    assert.equal(missingInstallationJson.jobs_created, 0);

    const unknownInstallation = await githubRequest({
      event: 'push',
      payload: pushPayload({ installationId: String(900_000 + randomBytes(4).readUInt32BE(0)) }),
    });
    assert.equal(unknownInstallation.status, 202);
    const unknownInstallationJson = await unknownInstallation.json();
    assert.equal(unknownInstallationJson.ignored_reason, 'unknown_installation');
    assert.equal(unknownInstallationJson.jobs_created, 0);

    const missingRepo = await githubRequest({
      event: 'push',
      payload: pushPayload({ repo: `${TEST_SLUG}/other-repo` }),
    });
    assert.equal(missingRepo.status, 202);
    const missingJson = await missingRepo.json();
    assert.equal(missingJson.matched_sources, 0);
    assert.equal(missingJson.jobs_created, 0);

    const manualRepo = await githubRequest({
      event: 'push',
      payload: pushPayload({ repo: MANUAL_REPO }),
    });
    assert.equal(manualRepo.status, 202);
    const manualJson = await manualRepo.json();
    assert.equal(manualJson.matched_sources, 0);
    assert.equal(manualJson.jobs_created, 0);

    const wrongBranch = await githubRequest({
      event: 'push',
      payload: pushPayload({ repo: DEV_REPO, ref: 'refs/heads/feature' }),
    });
    assert.equal(wrongBranch.status, 202);
    const branchJson = await wrongBranch.json();
    assert.equal(branchJson.matched_sources, 1);
    assert.equal(branchJson.jobs_created, 0);
    assert.equal(branchJson.skipped_branch, 1);
  });

  it('skips sources whose githubInstallationId does not match the webhook installation', async () => {
    const secondInstallationId = String(300_000 + randomBytes(4).readUInt32BE(0));
    const mismatchRepo = `${TEST_SLUG}/mismatch-repo`;

    await db.insert(githubAppInstallations).values({
      workspaceId,
      installationId: secondInstallationId,
      accountLogin: `second-${TEST_SLUG}`,
      accountType: 'Organization',
      repositorySelection: 'selected',
      permissions: { contents: 'read', metadata: 'read' },
      events: ['push'],
    });

    await db.insert(sources).values({
      workspaceId,
      kind: 'github_repo',
      identifier: mismatchRepo,
      displayName: 'mismatch repo',
      config: { branch: 'main', githubInstallationId: secondInstallationId },
      indexStrategy: 'webhook',
      status: 'indexed',
    });

    const res = await githubRequest({
      event: 'push',
      payload: pushPayload({ repo: mismatchRepo, installationId: INSTALLATION_ID }),
    });
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.equal(json.matched_installations, 1);
    assert.equal(json.matched_sources, 1);
    assert.equal(json.skipped_installation, 1);
    assert.equal(json.jobs_created, 0);
  });
});
