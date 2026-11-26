import {
    getAccount,
    setActiveAccount,
    updateAccount,
} from '../../core/accounts';
import { setCurrentCacheUserId } from '../../core/query/query-persister';
import { connectSocket } from '../../core/socket';
import { useAuthStore } from './auth-store';
import { resetInMemorySession } from './session-teardown';
import { isTokenExpired } from './token-expiry';
import {
    RefreshRequestFailure,
    requestRefreshedTokens,
    setCachedAccessToken,
} from './token-service';

/**
 * Switching to a saved account.
 *
 * The target's access token is validated FIRST (refreshing it off the active
 * session when it is expired) so a dead account never tears down the current
 * one. Only then is everything in memory reset, the active pointer moved and a
 * fresh socket opened with the new token. `connectSocket` disconnects the old
 * socket itself, so two connections never coexist.
 */

export type SwitchAccountFailure = 'missing' | 'expired' | 'unavailable';

export type SwitchAccountResult =
    | { ok: true }
    | { ok: false; reason: SwitchAccountFailure };

export async function switchAccount(
    targetUserId: number,
): Promise<SwitchAccountResult> {
    const current = useAuthStore.getState();
    if (current.status === 'authenticated' && current.userId === targetUserId) {
        return { ok: true };
    }

    const target = await getAccount(targetUserId);
    if (target === null) {
        return { ok: false, reason: 'missing' };
    }

    let accessToken = target.accessToken;
    let refreshToken = target.refreshToken;

    if (isTokenExpired(accessToken)) {
        if (refreshToken === '') {
            return { ok: false, reason: 'expired' };
        }
        try {
            const refreshed = await requestRefreshedTokens(refreshToken);
            accessToken = refreshed.accessToken;
            refreshToken = refreshed.newRefreshToken ?? refreshToken;
            await updateAccount(targetUserId, { accessToken, refreshToken });
        } catch (error) {
            return {
                ok: false,
                reason:
                    error instanceof RefreshRequestFailure &&
                    error.kind === 'rejected'
                        ? 'expired'
                        : 'unavailable',
            };
        }
    }

    // From here on nothing can fail: the target has a usable token.
    await setActiveAccount(targetUserId);
    resetInMemorySession();
    setCurrentCacheUserId(targetUserId);
    setCachedAccessToken(accessToken);
    connectSocket(accessToken);
    useAuthStore.setState({
        status: 'authenticated',
        userId: targetUserId,
        sessionNotice: null,
    });
    return { ok: true };
}
