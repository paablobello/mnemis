import { researchRunCreditCost, withWorkspaceUsageLock } from '@mnemis/saas';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db.ts';
import { requireScopes } from '../middleware/auth.ts';
import { readJsonBody } from '../middleware/body-limit.ts';
import { assertCreditsAvailableWithDb, assertResearchQuotaWithDb } from '../services/quotas.ts';
import {
  createResearchRun,
  getResearchRun,
  listResearchRuns,
  researchRunToDto,
} from '../services/research.ts';
import { recordUsageWithDb } from '../services/usage.ts';
import { createResearchRunSchema, listResearchRunsQuerySchema } from '../validators/research.ts';

export const researchRoutes = new Hono();

const idParam = z.string().uuid();

researchRoutes.post('/runs', requireScopes('research:write', 'sources:write'), async (c) => {
  const auth = c.get('auth');
  const body = await readJsonBody(c.req.raw);
  const input = createResearchRunSchema.parse(body);
  const estimatedCredits = researchRunCreditCost(input.depth ?? 'standard');
  const result = await withWorkspaceUsageLock(getDb(), auth.workspaceId, async (db) => {
    await assertResearchQuotaWithDb(db, auth.workspaceId);
    await assertCreditsAvailableWithDb(db, auth.workspaceId, estimatedCredits);
    const created = await createResearchRun(auth.workspaceId, input, db);
    await recordUsageWithDb(db, c, 'research', estimatedCredits, {
      research_run_id: created.data.id,
      job_id: created.job.id,
      depth: input.depth,
    });
    return created;
  });
  return c.json(result, 202);
});

researchRoutes.get('/runs', requireScopes('research:read', 'sources:read'), async (c) => {
  const auth = c.get('auth');
  const query = listResearchRunsQuerySchema.parse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  const result = await listResearchRuns(auth.workspaceId, query);
  return c.json({
    items: result.items.map(researchRunToDto),
    total: result.total,
    has_more: result.has_more,
    limit: query.limit,
    offset: query.offset,
  });
});

researchRoutes.get('/runs/:id', requireScopes('research:read', 'sources:read'), async (c) => {
  const auth = c.get('auth');
  const id = idParam.parse(c.req.param('id'));
  const run = await getResearchRun(auth.workspaceId, id);
  return c.json({ data: researchRunToDto(run) });
});
