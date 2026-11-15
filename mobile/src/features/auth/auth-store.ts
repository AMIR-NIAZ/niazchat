import { create } from 'zustand';
import {
    clearTokens,
    readAccessToken,
    readRefreshToken,
    writeTokens,
} from '../../core/storage/secure-token.storage';
import { setCurrentCacheUserId } from '../../core/query/query-persister';
import { connectSocket } from '../../core/socket';
import { accessTokenSubject } from './access-token-subject';
import { refreshSession } from './session-refresh';
import { decideColdStart } from './session-refresh-model';
import { isTokenExpired } from './token-expiry';
import { forgetCachedTokens, setCachedAccessToken } from './token-service';

/**
 * Session state (client-side only; the backend has no logout/revocation).
 * Holds status only — the token pair lives in SecureStore, never in React state.
 *
 * `unreachable` is the cold-start state where the refresh could not run
 * (network/timeout/5xx) AND the stored access token is unusable: the UI shows
 * "Can't reach the server" with Retry instead of redirecting to login.
 */

export type AuthStatus =
    | 'restoring'
    | 'authenticated'
    | 'guest'
    | 'unreachable';

export const SESSION_EXPIRED_NOTICE =
    'Your session has expired. Please sign in again.';

export interface AuthState {
    /** `restoring` = reading SecureStore / refreshing at startup. */
    status: AuthStatus;
    /**
     * Numeric user id from the access token's `sub` — the ONE stable source of
     * truth for "is this mine?". Never derived from the profile cache, so a
     * profile refetch can never change or lose it.
     */
    userId: number | null;
    /** Non-blocking banner on the login screen (expired session). */
    sessionNotice: string | null;
    /** Restores tokens from SecureStore at startup, refreshing first. */
    restoreSession: () => Promise<void>;
    /** Retry after an `unreachable` cold start (also used by the retry button). */
    retryRestore: () => Promise<void>;
    /** Persists the JWT pair (from `POST /auth/verify-otp` data) and opens the socket. */
    storeSession: (accessToken: string, refreshToken: string) => Promise<void>;
    /** Used by the logout flow after storage/socket/cache cleanup. */
    resetSessionState: (reason: 'expired' | 'manual') => void;
    clearSessionNotice: () => void;
}

/** Guards against two overlapping restores (React StrictMode double effects). */
let restoreGeneration = 0;

export const useAuthStore = create<AuthState>((set, get) => ({
    status: 'restoring',
    userId: null,
    sessionNotice: null,

    restoreSession: async () => {
        const generation = ++restoreGeneration;
        set({ status: 'restoring' });

        const storedAccessToken = await readAccessToken();
        const storedRefreshToken = await readRefreshToken();
        if (generation !== restoreGeneration) {
            return;
        }

        if (storedAccessToken === null && storedRefreshToken === null) {
            forgetCachedTokens();
            setCurrentCacheUserId(null);
            set({ status: 'guest', userId: null });
            return;
        }

        if (storedAccessToken !== null) {
            setCachedAccessToken(storedAccessToken);
            // The token's `sub` is enough to enter the app: the session is NOT
            // validated against the network here. Cached profile/chats render
            // immediately and the lifecycle refreshes in the background. An
            // unreachable backend is never an auth failure.
            const storedUserId = accessTokenSubject(storedAccessToken);
            if (storedUserId !== null) {
                setCurrentCacheUserId(storedUserId);
                connectSocket(storedAccessToken);
                set({
                    status: 'authenticated',
                    userId: storedUserId,
                    sessionNotice: null,
                });
                return;
            }
        }

        // No usable stored access token (e.g. token-only recovery): the refresh
        // round-trip is the only way to learn the identity.
        const refreshResult =
            storedRefreshToken === null ? null : await refreshSession();
        if (generation !== restoreGeneration) {
            return;
        }

        const outcome = decideColdStart({
            accessToken: storedAccessToken,
            hasRefreshToken: storedRefreshToken !== null,
            refreshResult,
            storedAccessTokenUsable:
                storedAccessToken !== null &&
                !isTokenExpired(storedAccessToken),
        });

        if (outcome.kind === 'guest') {
            // Definitive end of the session (or unusable + no refresh token).
            await clearTokens();
            forgetCachedTokens();
            setCurrentCacheUserId(null);
            set({ status: 'guest', userId: null });
            return;
        }

        if (outcome.kind === 'unreachable') {
            setCurrentCacheUserId(null);
            set({ status: 'unreachable', userId: null });
            return;
        }

        const userId = accessTokenSubject(outcome.accessToken);
        setCachedAccessToken(outcome.accessToken);
        setCurrentCacheUserId(userId);
        connectSocket(outcome.accessToken);
        set({
            status: 'authenticated',
            userId,
            sessionNotice: null,
        });
    },

    retryRestore: async () => {
        await get().restoreSession();
    },
    storeSession: async (accessToken, refreshToken) => {
        // Invalidate any restore still in flight (a fresh login wins).
        restoreGeneration += 1;
        await writeTokens(accessToken, refreshToken);
        setCachedAccessToken(accessToken);
        const userId = accessTokenSubject(accessToken);
        setCurrentCacheUserId(userId);
        connectSocket(accessToken);
        set({
            status: 'authenticated',
            userId,
            sessionNotice: null,
        });
    },

    resetSessionState: (reason) => {
        setCurrentCacheUserId(null);
        set({
            status: 'guest',
            userId: null,
            sessionNotice: reason === 'expired' ? SESSION_EXPIRED_NOTICE : null,
        });
    },

    clearSessionNotice: () => {
        set({ sessionNotice: null });
    },
}));

/**
 * Current user id for ownership checks. Session-derived (access token `sub`),
 * numeric, and unaffected by profile/cache refetches.
 */
export function useCurrentUserId(): number | null {
    return useAuthStore((state) => state.userId);
}
