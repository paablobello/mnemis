import { Hono } from 'hono';
import { githubRoutes } from './github.ts';
import { memoriesRoutes } from './memories.ts';
import { researchRoutes } from './research.ts';
import { searchRoutes } from './search.ts';
import { sourcesRoutes } from './sources.ts';

export const v1 = new Hono();

v1.route('/github', githubRoutes);
v1.route('/memories', memoriesRoutes);
v1.route('/research', researchRoutes);
v1.route('/sources', sourcesRoutes);
v1.route('/search', searchRoutes);

v1.get('/', (c) => {
  const auth = c.get('auth');
  return c.json({
    workspace_id: auth.workspaceId,
    endpoints: [
      '/v1/memories',
      '/v1/memories/search',
      '/v1/memories/semantic-search',
      '/v1/research/runs',
      '/v1/github/installations',
      '/v1/sources',
      '/v1/search',
      '/v1/webhooks/github',
    ],
  });
});
