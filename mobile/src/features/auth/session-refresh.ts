import { readRefreshToken } from '../../core/storage/secure-token.storage';
import {
    createSingleFlight,
    type RefreshSessionResult,
} from './session-refresh-model';
import {
    RefreshRequestFailure,
    requestRefreshedTokens,
    storeRefreshedTokens,
} from './token-service';

/**
 * THE session refresh service.
 *
 * Every caller (cold start, foreground, HTTP 401, WebSocket auth error,
 * proactive timer) goes through `refreshSession()`. Concurrent callers share
 * one in-flight request: one refresh round-trip, one result for everybody.
 *
 * `refreshSession()` never throws and never logs out by itself — it reports
 * `rejected` (definitive: no refresh token, or the endpoint said 401/403) or
 * `unavailable` (network, timeout, 5xx, 429, abort). Callers decide.
 */ let activeController: AbortController | null = null;
/** Bumped on logout so a response that lands late cannot resurrect tokens. */
let sessionEpoch = 0;

async function runRefresh(): Promise<RefreshSessionResult> {
    const startedEpoch = sessionEpoch;
    const refreshToken = await readRefreshToken();
    if (refreshToken === null || refreshToken.trim() === '') {
        return { status: 'rejected' };
    }

    const controller = new AbortController();
    activeController = controller;
    try {
        const tokens = await requestRefreshedTokens(
            refreshToken,
            controller.signal,
        );
        if (startedEpoch !== sessionEpoch) {
            // The session was logged out while this request was in flight: never
            // write tokens back into cleared storage.
            return { status: 'unavailable' };
        }
        // No rotation today: keep the existing refresh token unless the server
        // explicitly sends a new one.
        await storeRefreshedTokens(
            tokens.accessToken,
            tokens.newRefreshToken ?? refreshToken,
        );
        return { status: 'ok', accessToken: tokens.accessToken };
    } catch (error) {
        if (error instanceof RefreshRequestFailure) {
            return { status: error.kind };
        }
        return { status: 'unavailable' };
    } finally {
        if (activeController === controller) {
            activeController = null;
        }
    }
}

const single = createSingleFlight(runRefresh);

/** Single-flight refresh; see the module comment. */
export function refreshSession(): Promise<RefreshSessionResult> {
    return single.start();
}

/**
 * Waits for an in-flight refresh so a request/socket (re)connect never goes out
 * with a token that is about to be replaced. Resolves immediately when idle.
 */
export function ensureFreshSession(): Promise<void> {
    return single.wait();
} /** Aborts and forgets an in-flight refresh (logout). */
export function cancelSessionRefresh(): void {
    sessionEpoch += 1;
    const controller = activeController;
    activeController = null;
    single.cancel();
    controller?.abort();
}

export type { RefreshSessionResult };
