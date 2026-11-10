import { AppState, type AppStateStatus } from 'react-native';
import {
    getSocket,
    getSocketToken,
    reconnectSocket,
    registerSocketAuthErrorHandler,
} from '../../core/socket';
import { registerSessionCleanup } from '../../core/session/cleanup-registry';
import { logout } from './logout';
import { useAuthStore } from './auth-store';
import { refreshSession } from './session-refresh';
import { getTokenExpiry, isTokenExpired } from './token-expiry';
import { getAccessToken } from './token-service';
import { TOKEN_EXPIRY_MARGIN_SECONDS } from './session-refresh-model';

/**
 * Session lifecycle while the app is running:
 *
 * - Foreground: when the app becomes `active` after more than 20 s in the
 *   background (JS timers do not run there) or when the access token is about
 *   to expire, refresh FIRST, then let the socket reconnect and the screens
 *   re-join/refetch through the existing onSocketReconnect hooks.
 * - Proactive: ONE timer scheduled from the token `exp` (60 s before expiry),
 *   re-armed after every refresh/foreground and cleared in the background.
 * - `unavailable`: keep the session and retry with exponential backoff while
 *   the app is active; `rejected`: logout.
 * - WebSocket auth errors share the same single-flight refresh with a cooldown.
 */

/** Foreground refreshes the session after this long in the background. */
export const FOREGROUND_REFRESH_THRESHOLD_MS = 20_000;
const AUTH_ERROR_COOLDOWN_MS = 5_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
const MIN_TIMER_MS = 1_000;

let started = false;
let appState: AppStateStatus = (AppState.currentState ??
    'active') as AppStateStatus;
let backgroundedAt: number | null = null;
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = RETRY_BASE_MS;
let lastAuthErrorAt = 0;

type Stop = () => void;
let stopAppState: Stop | null = null;
let stopStore: Stop | null = null;
let stopSocketAuth: Stop | null = null;

function clearProactiveTimer(): void {
    if (proactiveTimer !== null) {
        clearTimeout(proactiveTimer);
        proactiveTimer = null;
    }
}

function clearRetryTimer(): void {
    if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}

/** Logout cleanup: cancels timers but keeps the listeners for the next login. */
export function clearSessionLifecycleTimers(): void {
    clearProactiveTimer();
    clearRetryTimer();
    backgroundedAt = null;
    retryDelayMs = RETRY_BASE_MS;
}

async function isAccessTokenExpiring(): Promise<boolean> {
    const token = await getAccessToken();
    return isTokenExpired(token);
}

/**
 * Reconnect ONLY when the live socket is missing/disconnected or was created
 * with an older token: the guard validates the handshake header on every event,
 * so a stale header keeps failing even while connected.
 */
function syncSocketToken(accessToken: string): void {
    const socket = getSocket();
    if (
        socket === null ||
        !socket.connected ||
        getSocketToken() !== accessToken
    ) {
        reconnectSocket(accessToken);
    }
}

async function scheduleProactiveRefresh(): Promise<void> {
    clearProactiveTimer();
    if (
        useAuthStore.getState().status !== 'authenticated' ||
        appState !== 'active'
    ) {
        return;
    }
    const expiryMs = getTokenExpiry(await getAccessToken());
    if (expiryMs === null) {
        return;
    }
    const delayMs = Math.max(
        MIN_TIMER_MS,
        expiryMs - Date.now() - TOKEN_EXPIRY_MARGIN_SECONDS * 1000,
    );
    proactiveTimer = setTimeout((): void => {
        proactiveTimer = null;
        void refreshForSession();
    }, delayMs);
}

function scheduleRetry(): void {
    if (
        retryTimer !== null ||
        useAuthStore.getState().status !== 'authenticated' ||
        appState !== 'active'
    ) {
        return;
    }
    retryTimer = setTimeout((): void => {
        retryTimer = null;
        void refreshForSession();
    }, retryDelayMs);
    retryDelayMs = Math.min(RETRY_MAX_MS, retryDelayMs * 2);
}

async function refreshForSession(): Promise<void> {
    // A logout/guest state must never start (or continue) a refresh.
    if (useAuthStore.getState().status !== 'authenticated') {
        return;
    }
    const result = await refreshSession();
    if (result.status === 'ok') {
        retryDelayMs = RETRY_BASE_MS;
        clearRetryTimer();
        syncSocketToken(result.accessToken);
        void scheduleProactiveRefresh();
        return;
    }
    if (result.status === 'rejected') {
        await logout('expired');
        return;
    }
    // unavailable: keep the session, retry later while the app is active.
    if (useAuthStore.getState().status === 'authenticated') {
        scheduleRetry();
    }
}

function scheduleUnreachableRetry(): void {
    if (
        retryTimer !== null ||
        useAuthStore.getState().status !== 'unreachable' ||
        appState !== 'active'
    ) {
        return;
    }
    retryTimer = setTimeout((): void => {
        retryTimer = null;
        void useAuthStore
            .getState()
            .retryRestore()
            .finally((): void => {
                if (useAuthStore.getState().status === 'unreachable') {
                    void scheduleUnreachableRetry();
                } else {
                    retryDelayMs = RETRY_BASE_MS;
                }
            });
    }, retryDelayMs);
    retryDelayMs = Math.min(RETRY_MAX_MS, retryDelayMs * 2);
}

async function handleForeground(elapsedMs: number | null): Promise<void> {
    const status = useAuthStore.getState().status;

    if (status === 'unreachable') {
        retryDelayMs = RETRY_BASE_MS;
        await useAuthStore.getState().retryRestore();
        return;
    }
    if (status !== 'authenticated') {
        return;
    }

    const longBackground =
        elapsedMs !== null && elapsedMs > FOREGROUND_REFRESH_THRESHOLD_MS;
    if (longBackground || (await isAccessTokenExpiring())) {
        await refreshForSession();
        return;
    }
    void scheduleProactiveRefresh();
}

function handleAppStateChange(next: AppStateStatus): void {
    const previous = appState;
    appState = next;

    if (next !== 'active') {
        if (previous === 'active') {
            backgroundedAt = Date.now();
        }
        clearProactiveTimer();
        clearRetryTimer();
        return;
    }

    const elapsedMs =
        backgroundedAt === null ? null : Date.now() - backgroundedAt;
    backgroundedAt = null;
    void handleForeground(elapsedMs);
}

function handleSocketAuthError(): void {
    if (useAuthStore.getState().status !== 'authenticated') {
        return;
    }
    const now = Date.now();
    if (now - lastAuthErrorAt < AUTH_ERROR_COOLDOWN_MS) {
        return;
    }
    lastAuthErrorAt = now;
    void refreshForSession();
}

function handleStatusChange(status: string): void {
    if (status === 'authenticated') {
        retryDelayMs = RETRY_BASE_MS;
        void scheduleProactiveRefresh();
        return;
    }
    clearProactiveTimer();
    if (status === 'unreachable') {
        void scheduleUnreachableRetry();
    } else {
        clearRetryTimer();
    }
}

/**
 * Registers the AppState listener, the store subscription and the socket
 * auth-error handler exactly once. Returns a stop function for unmount.
 */
export function startSessionLifecycle(): Stop {
    if (started) {
        return stopSessionLifecycle;
    }
    started = true;

    const subscription = AppState.addEventListener(
        'change',
        handleAppStateChange,
    );
    stopAppState = (): void => subscription.remove();

    stopStore = useAuthStore.subscribe((state, previous) => {
        if (state.status !== previous.status) {
            handleStatusChange(state.status);
        }
    });

    stopSocketAuth = registerSocketAuthErrorHandler(handleSocketAuthError);

    if (useAuthStore.getState().status === 'authenticated') {
        void scheduleProactiveRefresh();
    }

    return stopSessionLifecycle;
}

export function stopSessionLifecycle(): void {
    clearSessionLifecycleTimers();
    stopAppState?.();
    stopStore?.();
    stopSocketAuth?.();
    stopAppState = null;
    stopStore = null;
    stopSocketAuth = null;
    started = false;
}

registerSessionCleanup(clearSessionLifecycleTimers);
