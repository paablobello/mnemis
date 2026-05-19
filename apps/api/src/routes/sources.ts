import { Hono } from 'hono';
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

sourcesRoutes.post('/:id/reindex', requireScopes('sources:write'), async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const { job } = await enqueueReindex(auth.workspaceId, id);
  return c.json({ job: jobToDto(job) }, 202);
});
