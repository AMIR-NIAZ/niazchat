import { router } from 'expo-router';
import { getAccounts, removeAccount } from '../../core/accounts';
import { setCurrentCacheUserId } from '../../core/query/query-persister';
import { clearAllLocalData } from '../../shared/local-db';
import { useAuthStore } from './auth-store';
import { switchAccount } from './account-switch';
import { resetInMemorySession } from './session-teardown';

/**
 * Account logout (there is no backend endpoint, so deleting the account's
 * SecureStore record IS the logout):
 *
 * - the removed account's persisted query cache and SQLite database go too;
 * - if it was ACTIVE, the next saved account is activated (socket + state
 *   reset by `switchAccount`); when none is left the app returns to the login
 *   screen;
 * - logging out an INACTIVE account never touches the running session.
 *
 * Idempotent: concurrent failures share one run.
 */

export type LogoutReason = 'expired' | 'manual';

let activeLogout: Promise<void> | null = null;

function leaveTo(path: '/(auth)/login' | '/(app)'): void {
    // Prefer the auth guard's navigation, but make sure the whole stack is
    // replaced here too: Back must never return to a protected screen.
    try {
        router.dismissAll();
    } catch {
        // Nothing dismissable (already at a root screen).
    }
    router.replace(path);
}

async function performLogout(
    userId: number,
    reason: LogoutReason,
): Promise<void> {
    resetInMemorySession();
    await removeAccount(userId);
    setCurrentCacheUserId(null);
    await clearAllLocalData(userId);

    // One of the other saved accounts takes over when it can produce a usable
    // token. A definitively rejected account is deleted and skipped; an
    // unreachable one is kept (it may still work once the network is back).
    const remaining = await getAccounts();
    for (const account of remaining) {
        const result = await switchAccount(account.userId);
        if (result.ok) {
            leaveTo('/(app)');
            return;
        }
        if (result.reason === 'expired' || result.reason === 'missing') {
            await removeAccount(account.userId);
            await clearAllLocalData(account.userId);
            continue;
        }
        break;
    }

    useAuthStore.getState().resetSessionState(reason);
    leaveTo('/(auth)/login');
}

/** Logs out the ACTIVE account. */
export function logout(reason: LogoutReason = 'manual'): Promise<void> {
    if (activeLogout !== null) {
        return activeLogout;
    }
    const state = useAuthStore.getState();
    const userId = state.userId;
    if (userId === null || state.status === 'guest') {
        return Promise.resolve();
    }
    const tracked: Promise<void> = performLogout(userId, reason).finally(
        (): void => {
            if (activeLogout === tracked) {
                activeLogout = null;
            }
        },
    );
    activeLogout = tracked;
    return tracked;
}

/** Logs out one specific account (active or not) from the accounts list. */
export async function logoutAccount(userId: number): Promise<void> {
    const state = useAuthStore.getState();
    if (state.status === 'authenticated' && state.userId === userId) {
        await logout('manual');
        return;
    }
    await removeAccount(userId);
    await clearAllLocalData(userId);
}
