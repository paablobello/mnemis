export class MnemisApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'MnemisApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class MnemisTimeoutError extends Error {
  constructor(message = 'Mnemis API request timed out') {
    super(message);
    this.name = 'MnemisTimeoutError';
  }
}

export class MnemisNetworkError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'MnemisNetworkError';
    this.cause = cause;
  }
}
