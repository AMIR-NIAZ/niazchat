/**
 * Auth feature — phone (Iranian) OTP login, JWT session persistence, refresh.
 *
 * Backend contract summary (docs/mobile-api/authentication.md):
 * - `POST /auth/send-otp` / `POST /auth/verify-otp` (verify returns `{ data: { accessToken, refreshToken } }`).
 * - Refresh: `POST /auth/refresh-token` with raw `token` header; access token 1 h,
 *   refresh token 30 d, and the refresh token is NOT rotated.
 * - Invalid/expired/mismatched refresh token → 401 `{ message: 'invalid refresh token' }`.
 * - No logout endpoint; session teardown is client-side only.
 * - Registration is implicit (user row created on first `verify-otp`).
 * - No email support at all — phone numbers only.
 *
 * Wire-up: `registerAuthTokenProvider()` must run exactly once at app bootstrap
 * and `startSessionLifecycle()` mounts the foreground/proactive refresh.
 */
export * from './auth-store';
export * from './access-token-subject';
export * from './auth-bootstrap';
export * from './logout';
export * from './session-lifecycle';
export * from './session-refresh';
export * from './session-refresh-model';
export * from './token-expiry';
export * from './token-service';
export * from './auth-service';
export * from './use-auth-flow';
export * from './validators';
export * from './use-auth-screen-guard';
