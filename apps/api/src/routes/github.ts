import { Hono } from 'hono';
import { requireScopes } from '../middleware/auth.ts';
import { readJsonBody } from '../middleware/body-limit.ts';
import {
  githubInstallationToDto,
  listGitHubInstallations,
  registerGitHubInstallation,
} from '../services/github-installations.ts';
import { registerGitHubInstallationSchema } from '../validators/github.ts';

export const githubRoutes = new Hono();

githubRoutes.get('/installations', requireScopes('sources:read'), async (c) => {
  const auth = c.get('auth');
  const installations = await listGitHubInstallations(auth.workspaceId);
  return c.json({ items: installations.map(githubInstallationToDto) });
});

githubRoutes.post('/installations', requireScopes('sources:write'), async (c) => {
  const auth = c.get('auth');
  const body = await readJsonBody(c.req.raw);
  const input = registerGitHubInstallationSchema.parse(body);
  const installation = await registerGitHubInstallation(auth.workspaceId, input);
  return c.json({ data: githubInstallationToDto(installation) }, 201);
});
