import { Hono } from 'hono';
import { memoriesRoutes } from './memories.ts';
import { searchRoutes } from './search.ts';
import { sourcesRoutes } from './sources.ts';

export const v1 = new Hono();

v1.route('/memories', memoriesRoutes);
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
      '/v1/sources',
      '/v1/search',
    ],
  });
});
