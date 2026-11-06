/**
 * Registry that lets the HTTP client obtain the current access token without
 * importing the auth feature (which itself imports the HTTP client — avoids a
 * circular dependency). features/auth wires a concrete provider at startup.
 */

export interface ApiTokenProvider {
  /** Current access token, or null when there is no active session. */
  getAccessToken(): Promise<string | null>;

  /**
   * Attempt a single refresh-token call.
   * Backend contract: `POST /auth/refresh-token` with the raw `token` header
   * (NOT Authorization). Resolves with the new access token or null on failure.
   */
  refreshAccessToken(): Promise<string | null>;

  /** Whether a refresh token exists (i.e. a refresh round-trip makes sense). */
  isRefreshPossible(): Promise<boolean>;

  /** Invoked when a 401 survives a refresh attempt — the session is dead. */
  onSessionExpired(): void;
}

let provider: ApiTokenProvider | null = null;

export function registerApiTokenProvider(next: ApiTokenProvider): void {
  provider = next;
}

export function getApiTokenProvider(): ApiTokenProvider {
  if (!provider) {
    throw new Error(
      'ApiTokenProvider is not registered. Call registerApiTokenProvider from features/auth during app bootstrap.',
    );
  }
  return provider;
}

export function hasApiTokenProvider(): boolean {
  return provider !== null;
}
