import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { ApiError } from './errors.ts';
import { apiKeyAuth } from './middleware/auth.ts';
import { bodySizeLimit } from './middleware/body-limit.ts';
import { rateLimit } from './middleware/rate-limit.ts';
import { admin } from './routes/admin.ts';
import { health } from './routes/health.ts';
import { v1 } from './routes/v1.ts';
import { webhooksRoutes } from './routes/webhooks.ts';
import { EmbeddingsProviderError } from './services/embeddings.ts';

export interface AppOptions {
  /** Disable hono's built-in logger middleware (handy in tests). */
  silent?: boolean;
}

/**
 * Builds a Hono app with all middleware and routes wired. Used by both
 * `index.ts` (real server) and integration tests (in-process via `app.request`).
 */
export function createApp(opts: AppOptions = {}): Hono {
  const app = new Hono();

  if (!opts.silent) app.use('*', logger());
  app.use('*', secureHeaders());

  app.get('/', (c) =>
    c.json({
      name: 'mnemis-api',
      version: process.env.MNEMIS_VERSION ?? '0.0.0',
      docs: 'https://github.com/paablobello/mnemis',
    }),
  );

  app.route('/health', health);

  app.use('/v1/webhooks/*', bodySizeLimit);
  app.route('/v1/webhooks', webhooksRoutes);

  app.use('/v1/*', bodySizeLimit);
  app.use('/v1/*', apiKeyAuth);
  app.use('/v1/*', rateLimit);
  app.route('/v1', v1);
  app.route('/v1/admin', admin);

  app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      const body: Record<string, unknown> = { error: err.code, message: err.message };
      if (
        err.code === 'payload_too_large' &&
        typeof err.details === 'object' &&
        err.details !== null &&
        'max_body_bytes' in err.details
      ) {
        body.max_body_bytes = (err.details as { max_body_bytes: unknown }).max_body_bytes;
      } else if (err.details !== undefined) {
        body.details = err.details;
      }
      return c.json(
        body,
        // biome-ignore lint/suspicious/noExplicitAny: hono StatusCode union
        err.status as any,
      );
    }
    if (err instanceof ZodError) {
      return c.json(
        {
          error: 'validation_error',
          message: 'Request validation failed',
          details: err.flatten(),
        },
        400,
      );
    }
    if (err instanceof EmbeddingsProviderError) {
      return c.json({ error: err.code, message: err.message }, 424);
    }
    console.error('unhandled error', err);
    return c.json({ error: 'internal_error', message: 'Internal server error' }, 500);
  });

  return app;
}
