import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../errors.ts';

const DEFAULT_MAX_BODY_BYTES = 1_000_000;

export function maxBodyBytes(): number {
  const configured = Number.parseInt(process.env.MNEMIS_MAX_BODY_BYTES ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BODY_BYTES;
}

export async function readLimitedText(request: Request, max = maxBodyBytes()): Promise<string> {
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytes += value.byteLength;
      if (bytes > max) {
        await reader.cancel().catch(() => undefined);
        throw ApiError.payloadTooLarge(max);
      }

      text += decoder.decode(value, { stream: true });
    }

    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await readLimitedText(request);
  try {
    return JSON.parse(text);
  } catch {
    throw ApiError.badRequest('invalid_json', 'Body must be valid JSON');
  }
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
