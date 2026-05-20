import type { MiddlewareHandler } from 'hono';

const DEFAULT_MAX_BODY_BYTES = 1_000_000;

function maxBodyBytes(): number {
  const configured = Number.parseInt(process.env.MNEMIS_MAX_BODY_BYTES ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BODY_BYTES;
}

export const bodySizeLimit: MiddlewareHandler = async (c, next) => {
  const contentLength = c.req.header('content-length');
  const max = maxBodyBytes();
  if (contentLength) {
    const length = Number.parseInt(contentLength, 10);
    if (Number.isFinite(length) && length > max) {
      return c.json(
        {
          error: 'payload_too_large',
          message: `Request body exceeds ${max} bytes`,
          max_body_bytes: max,
        },
        413,
      );
    }
  }
  await next();
};
