// Normalized HTTP/network error type shared by the frontend HTTP client.
//
// The existing app throws plain `Error(message)` from the API client and the
// UI reads `e.message`. To stay 100% backward-compatible we keep throwing an
// Error subclass whose `.message` is identical to before — existing
// `e instanceof Error ? e.message : ...` checks continue to work unchanged.
//
// The extra fields (`status`, `code`) are additive and optional; nothing in the
// current UI depends on them, but new feature hooks can use them for richer
// handling without breaking anything.

export type ApiErrorCode =
  | 'NETWORK'          // could not reach the server
  | 'RATE_LIMITED'     // 429
  | 'UNAUTHORIZED'     // 401
  | 'HTTP'             // other non-2xx with a JSON/`error` body
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: ApiErrorCode;

  constructor(message: string, opts: { status?: number | null; code?: ApiErrorCode } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status ?? null;
    this.code = opts.code ?? 'UNKNOWN';
    // Preserve prototype chain for `instanceof` under transpilation.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}
