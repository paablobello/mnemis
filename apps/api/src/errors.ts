/**
 * Domain error type. Routes throw `ApiError`, the global onError converts it
 * into a deterministic JSON envelope. Anything else gets a 500 with a generic
 * message (full error in logs).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'unauthorized', message);
  }
  static forbidden(message = 'Forbidden') {
    return new ApiError(403, 'forbidden', message);
  }
  static notFound(resource: string) {
    return new ApiError(404, 'not_found', `${resource} not found`);
  }
  static conflict(code: string, message: string) {
    return new ApiError(409, code, message);
  }
  static failedDependency(code: string, message: string) {
    return new ApiError(424, code, message);
  }
  static payloadTooLarge(maxBodyBytes: number) {
    return new ApiError(413, 'payload_too_large', `Request body exceeds ${maxBodyBytes} bytes`, {
      max_body_bytes: maxBodyBytes,
    });
  }
  static internal(message = 'Internal server error') {
    return new ApiError(500, 'internal_error', message);
  }
}
