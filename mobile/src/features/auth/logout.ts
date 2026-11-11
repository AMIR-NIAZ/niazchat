import { router } from 'expo-router';
import { appQueryClient } from '../../core/query/query-client';
import { disconnectSocket } from '../../core/socket';
import { runSessionCleanups } from '../../core/session/cleanup-registry';
import { clearTokens } from '../../core/storage';
import { useAuthStore } from './auth-store';
import { createIdempotentAction } from './session-refresh-model';
import { cancelSessionRefresh } from './session-refresh';
import { forgetCachedTokens } from './token-service';
import { clearPendingInviteCode } from '../groups/pending-invite';

/**
 * The one logout flow (rejected session or explicit sign-out):
 * cancel the in-flight refresh + timers, stop playback/uploads, close the
 * socket, clear SecureStore + memory, clear the query cache, reset the auth
 * store, then land on the login screen from ANY depth.
 *
 * Idempotent: concurrent failures share one run, and once the store is `guest`
 * further calls are no-ops. A new login allows the next logout to run again.
 */

export type LogoutReason = 'expired' | 'manual';

let pendingReason: LogoutReason = 'manual';

async function performLogout(reason: LogoutReason): Promise<void> {
    cancelSessionRefresh();
    clearPendingInviteCode();
    // Registered hooks: voice/video playback, pending uploads, lifecycle timers.
    runSessionCleanups();
    disconnectSocket();
    await clearTokens();
    forgetCachedTokens();
    appQueryClient.clear();
    useAuthStore.getState().resetSessionState(reason);

    // Prefer the auth guard's navigation, but make sure the whole stack is
    // replaced here too: Back must never return to a protected screen.
    try {
        router.dismissAll();
    } catch {
        // Nothing dismissable (already at a root screen).
    }
    router.replace('/(auth)/login');
}

const runLogout = createIdempotentAction(
    (): Promise<void> => performLogout(pendingReason),
    (): boolean => useAuthStore.getState().status === 'guest',
);

export function logout(reason: LogoutReason = 'manual'): Promise<void> {
    pendingReason = reason;
    return runLogout();
}
