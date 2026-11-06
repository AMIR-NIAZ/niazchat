/**
 * Auth feature — phone (Iranian) OTP login, JWT session persistence, refresh.
 *
 * Backend contract summary (docs/mobile-api/authentication.md):
 * - `POST /auth/send-otp` / `POST /auth/verify-otp` (verify returns `{ data: { accessToken, refreshToken } }`).
 * - Refresh: `POST /auth/refresh-token` with raw `token` header; refresh token is never rotated.
 * - No logout endpoint; session teardown is client-side only.
 * - Registration is implicit (user row created on first `verify-otp`).
 * - No email support at all — phone numbers only.
 *
 * Wire-up: `registerAuthTokenProvider()` must run exactly once at app bootstrap.
 */
export * from './auth-store';
export * from './token-service';
export * from './auth-service';
export * from './use-auth-flow';
export * from './validators';
export * from './use-auth-screen-guard';
