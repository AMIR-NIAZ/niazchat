import { httpClient, ApiError } from '../../core/api';
import type {
  AuthTokensDto,
  SendOtpPayloadDto,
  VerifyOtpPayloadDto,
} from '../../core/api';

/**
 * Auth API layer — the ONLY place that talks to the auth REST endpoints.
 * Contracts come from docs/mobile-api/authentication.md (verbatim; the
 * occasional typos in endpoint responses are the backend's, kept as-is).
 */

/** `POST /auth/send-otp` → `{ message }`. */
export async function sendOtp(payload: SendOtpPayloadDto): Promise<void> {
  await httpClient.post('/auth/send-otp', payload);
}

/** `POST /auth/verify-otp` → `{ message, data: AuthTokensDto }`. Creates the user on first login. */
export async function verifyOtp(payload: VerifyOtpPayloadDto): Promise<AuthTokensDto> {
  const response = await httpClient.post<{ message: string; data: AuthTokensDto }>(
    '/auth/verify-otp',
    payload,
  );
  return response.data.data;
}

/** Human-friendly checkout of documented failure modes (match on status, not typo'd messages). */
export function describeAuthError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.statusCode) {
      case 400:
        return Array.isArray(error.rawMessage)
          ? error.rawMessage.join('; ')
          : 'The code is not correct.';
      case 401:
        return error.isAuthError ? 'Session expired. Please sign in again.' : 'This phone number is banned.';
      case 404:
        return 'No active code for this phone number. Request a new one (codes expire after 60 seconds).';
      case 429:
        return 'A code was already sent. Wait a moment before requesting again.';
      default:
        return error.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected error. Please try again.';
}
