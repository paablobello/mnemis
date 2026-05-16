import { Hono } from 'hono';
import { memoriesRoutes } from './memories.ts';

export const v1 = new Hono();

v1.route('/memories', memoriesRoutes);

v1.get('/', (c) => {
  const auth = c.get('auth');
  return c.json({
    workspace_id: auth.workspaceId,
    endpoints: ['/v1/memories', '/v1/memories/search', '/v1/memories/semantic-search'],
  });
});
