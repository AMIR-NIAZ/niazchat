/**
 * REST error envelope produced by the backend's global HttpExceptionFilter:
 *
 *   { success: false, statusCode: 400, message: string | string[] }
 *
 * `message` is an array of strings when the global ValidationPipe rejects the
 * request, otherwise a plain string. Status codes are the only stable signal —
 * some backend messages are non-standard or typo'd, so never branch on them.
 */

export interface ApiErrorEnvelope {
  success: false;
  statusCode: number;
  message: string | string[];
}

export type ApiValidationMessage = string;

/**
 * Normalized API failure surfaced to the app. Thrown by the HTTP client's
 * response interceptor for any non-2xx response (and network failures).
 */
export class ApiError extends Error {
  readonly statusCode: number;
  /** Raw envelope `message` — a string, or string[] for validation errors. */
  readonly rawMessage: string | string[];
  /** True only for 403 (backend rewrites those to `user not access`). */
  readonly isPermissionDenied: boolean;
  /** True only for 401 (missing/expired access token or refresh failure). */
  readonly isAuthError: boolean;

  constructor(envelope: ApiErrorEnvelope) {
    super(normalizeMessage(envelope.message));
    this.name = 'ApiError';
    this.statusCode = envelope.statusCode;
    this.rawMessage = envelope.message;
    this.isPermissionDenied = envelope.statusCode === 403;
    this.isAuthError = envelope.statusCode === 401;
  }
}

function normalizeMessage(message: string | string[]): string {
  return Array.isArray(message) ? message.join('; ') : message;
}
