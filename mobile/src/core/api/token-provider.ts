/**
 * Registry that lets the HTTP client obtain the current access token and run a
 * refresh without importing the auth feature (which itself imports the HTTP
 * client — avoids a circular dependency). features/auth wires a concrete
 * provider at bootstrap.
 */

/** Result type every refresh path shares (re-exported by features/auth). */
export type RefreshSessionResult =
    | { status: 'ok'; accessToken: string }
    | { status: 'rejected' }
    | { status: 'unavailable' };

export interface ApiTokenProvider {
    /** Current access token, or null when there is no active session. */
    getAccessToken(): Promise<string | null>;

    /** Waits for an in-flight refresh so the next request uses the newest token. */
    ensureFreshSession(): Promise<void>;

    /** Single-flight refresh; never throws. */
    refreshSession(): Promise<RefreshSessionResult>;

    /** The session is definitively gone: run the logout flow (idempotent). */
    onSessionRejected(): void;
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
