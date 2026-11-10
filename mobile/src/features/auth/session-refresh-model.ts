/**
 * Pure building blocks of the session-refresh machinery.
 *
 * Deliberately free of React Native / SecureStore / axios imports so the rules
 * can be unit tested with plain `ts-node`: refresh classification, single-flight
 * coalescing, crash-safe token write order, cold-start decision, logout
 * idempotency.
 */

/** Result type shared by every refresh caller (cold start, foreground, 401, WS). */
export type RefreshSessionResult =
    | { status: 'ok'; accessToken: string }
    | { status: 'rejected' }
    | { status: 'unavailable' };

/** Treat an access token as expired when it expires within this margin. */
export const TOKEN_EXPIRY_MARGIN_SECONDS = 60;

/**
 * 401/403 from the refresh endpoint is the ONLY definitive rejection. Network
 * errors, timeouts, aborted requests, 5xx and 429 are transient.
 */
export function classifyRefreshStatus(
    status: number | null | undefined,
): 'rejected' | 'unavailable' {
    return status === 401 || status === 403 ? 'rejected' : 'unavailable';
}

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

export interface TokenWrites {
    writeRefreshToken: (token: string) => Promise<void>;
    writeAccessToken: (token: string) => Promise<void>;
}

/**
 * Refresh token FIRST, access token second. A crash between the two writes
 * leaves the old access token with the new refresh token — never the reverse,
 * which would strand a rotated-away refresh token.
 */
export async function persistTokenPair(
    tokens: TokenPair,
    io: TokenWrites,
): Promise<void> {
    await io.writeRefreshToken(tokens.refreshToken);
    await io.writeAccessToken(tokens.accessToken);
}

export interface SingleFlight<T> {
    /** Starts the task, or returns the in-flight promise to concurrent callers. */
    start: () => Promise<T>;
    /** Resolves when any in-flight task settles (never rejects). */
    wait: () => Promise<void>;
    /** Forgets the in-flight task (used after an abort on logout). */
    cancel: () => void;
}

/** Concurrent callers share ONE invocation; each receives the same result. */
export function createSingleFlight<T>(run: () => Promise<T>): SingleFlight<T> {
    let inFlight: Promise<T> | null = null;

    const start = (): Promise<T> => {
        if (inFlight !== null) {
            return inFlight;
        }
        const tracked: Promise<T> = run().finally(() => {
            if (inFlight === tracked) {
                inFlight = null;
            }
        });
        inFlight = tracked;
        return tracked;
    };

    const wait = (): Promise<void> =>
        inFlight === null
            ? Promise.resolve()
            : inFlight.then(
                  (): void => undefined,
                  (): void => undefined,
              );

    const cancel = (): void => {
        inFlight = null;
    };

    return { start, wait, cancel };
}

/**
 * Runs `run` at most once while `isDone()` is true, and never concurrently.
 * Concurrent callers await the same invocation (several simultaneous auth
 * failures produce one logout); once the session is gone `isDone()` makes
 * later calls no-ops, and a new login (isDone false again) allows a new run.
 */
export function createIdempotentAction(
    run: () => Promise<void>,
    isDone: () => boolean,
): () => Promise<void> {
    let current: Promise<void> | null = null;

    return (): Promise<void> => {
        if (current !== null) {
            return current;
        }
        if (isDone()) {
            return Promise.resolve();
        }
        const tracked: Promise<void> = run().finally(() => {
            if (current === tracked) {
                current = null;
            }
        });
        current = tracked;
        return tracked;
    };
}

export type ColdStartOutcome =
    | { kind: 'guest' }
    | {
          kind: 'authenticated';
          accessToken: string;
          source: 'refreshed' | 'stored';
      }
    | { kind: 'unreachable' };

export interface ColdStartInput {
    /** Access token found in SecureStore (null when there is none). */
    accessToken: string | null;
    /** Whether a refresh token exists at all. */
    hasRefreshToken: boolean;
    /** Result of `refreshSession()`, or null when no refresh was attempted. */
    refreshResult: RefreshSessionResult | null;
    /** `true` when the stored access token is still valid (60 s margin). */
    storedAccessTokenUsable: boolean;
}

/**
 * Cold-start decision table:
 * - ok                  → authenticated with the fresh token;
 * - rejected            → guest (tokens will be cleared);
 * - unavailable + valid stored access → authenticated with it;
 * - unavailable + expired access + refresh token → "can't reach the server";
 * - no refresh token and unusable access → guest.
 */
export function decideColdStart(input: ColdStartInput): ColdStartOutcome {
    const {
        accessToken,
        hasRefreshToken,
        refreshResult,
        storedAccessTokenUsable,
    } = input;

    if (refreshResult !== null) {
        if (refreshResult.status === 'ok') {
            return {
                kind: 'authenticated',
                accessToken: refreshResult.accessToken,
                source: 'refreshed',
            };
        }
        if (refreshResult.status === 'rejected') {
            return { kind: 'guest' };
        }
    }

    if (accessToken !== null && storedAccessTokenUsable) {
        return { kind: 'authenticated', accessToken, source: 'stored' };
    }

    if (!hasRefreshToken) {
        return { kind: 'guest' };
    }

    return { kind: 'unreachable' };
}
