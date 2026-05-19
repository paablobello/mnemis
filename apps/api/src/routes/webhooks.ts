import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { ApiError } from '../errors.ts';
import {
  type GitHubPushPayload,
  handleGitHubPush,
  verifyGitHubSignature,
} from '../services/github-webhooks.ts';

export const webhooksRoutes = new Hono();

webhooksRoutes.post('/github', async (c) => {
  const rawBody = await c.req.text();
  verifyGitHubSignature({
    secret: process.env.GITHUB_WEBHOOK_SECRET,
    rawBody,
    signature: c.req.header('x-hub-signature-256'),
  });

  const event = c.req.header('x-github-event') ?? 'unknown';
  const deliveryId = c.req.header('x-github-delivery') ?? randomUUID();

  if (event === 'ping') {
    return c.json({ ok: true, event: 'ping', delivery_id: deliveryId });
  }

  if (event !== 'push') {
    return c.json({ ok: true, event, ignored: true, reason: 'unsupported_event' }, 202);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw ApiError.badRequest('invalid_json', 'GitHub webhook body must be valid JSON');
  }

  const result = await handleGitHubPush(payload as GitHubPushPayload, deliveryId);
  return c.json({ ok: true, delivery_id: deliveryId, ...result }, 202);
});
