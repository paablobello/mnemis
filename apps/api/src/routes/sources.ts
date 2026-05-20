import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { ApiError } from '../errors.ts';
import { requireScopes } from '../middleware/auth.ts';
import { jobToDto } from '../services/jobs.ts';
import {
  createSource,
  enqueueReindex,
  getSource,
  getSourceStatus,
  listSources,
  sourceToDto,
} from '../services/sources.ts';
import { createSourceSchema, listSourcesQuerySchema } from '../validators/sources.ts';

const STATUS_STREAM_INTERVAL_MS = 1_500;
const STATUS_STREAM_MAX_DURATION_MS = 10 * 60_000;

export const sourcesRoutes = new Hono();

const idParam = z.string().uuid();

sourcesRoutes.post('/', requireScopes('sources:write'), async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  });
  const input = createSourceSchema.parse(body);
  const { source, job } = await createSource(auth.workspaceId, input);

  return c.json(
    {
      data: sourceToDto(source),
      job: job ? jobToDto(job) : null,
    },
    201,
  );
});

sourcesRoutes.get('/', requireScopes('sources:read'), async (c) => {
  const auth = c.get('auth');
  const query = listSourcesQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const result = await listSources(auth.workspaceId, query);

  return c.json({
    items: result.items.map(sourceToDto),
    total: result.total,
    has_more: result.has_more,
    limit: query.limit,
    offset: query.offset,
  });
});

sourcesRoutes.get('/:id', requireScopes('sources:read'), async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const source = await getSource(auth.workspaceId, id);
  return c.json({ data: sourceToDto(source) });
});

sourcesRoutes.get('/:id/status', requireScopes('sources:read'), async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const status = await getSourceStatus(auth.workspaceId, id);
  return c.json(status);
});

sourcesRoutes.get('/:id/status/stream', requireScopes('sources:read'), (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));

  return streamSSE(c, async (stream) => {
    const deadline = Date.now() + STATUS_STREAM_MAX_DURATION_MS;
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    let eventId = 0;
    while (!aborted && Date.now() < deadline) {
      const snapshot = await getSourceStatus(auth.workspaceId, id);
      eventId += 1;
      const finished =
        snapshot.source.status === 'indexed' ||
        snapshot.source.status === 'failed' ||
        !snapshot.latest_job ||
        snapshot.latest_job.status === 'completed' ||
        snapshot.latest_job.status === 'failed';
      await stream.writeSSE({
        id: String(eventId),
        event: finished ? 'done' : 'progress',
        data: JSON.stringify(snapshot),
      });
      if (finished) return;
      await stream.sleep(STATUS_STREAM_INTERVAL_MS);
    }
  });
});

sourcesRoutes.post('/:id/reindex', requireScopes('sources:write'), async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const { job } = await enqueueReindex(auth.workspaceId, id);
  return c.json({ job: jobToDto(job) }, 202);
});
