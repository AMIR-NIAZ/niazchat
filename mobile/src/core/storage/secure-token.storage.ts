import {
    getActiveAccount,
    getActiveAccountId,
    updateAccount,
} from '../accounts';
import { persistTokenPair } from '../../features/auth/session-refresh-model';

/**
 * Secure token storage (iOS Keychain / Android EncryptedSharedPreferences).
 *
 * Tokens now live inside the per-account records in `core/accounts.ts`; these
 * helpers keep the existing session layer working by reading and writing the
 * ACTIVE account. Switching accounts changes the active pointer, so a refresh
 * in flight can never write into another account's record.
 *
 * The backend has no logout endpoint; deleting an account IS the logout.
 *
 * Write order matters: the refresh token is written before the access token so
 * a crash between the two writes can never leave a rotated-away refresh token
 * paired with a new access token.
 */

export async function readAccessToken(): Promise<string | null> {
    const account = await getActiveAccount();
    return account === null || account.accessToken === ''
        ? null
        : account.accessToken;
}

export async function readRefreshToken(): Promise<string | null> {
    const account = await getActiveAccount();
    return account === null || account.refreshToken === ''
        ? null
        : account.refreshToken;
}

/** Persists a refreshed pair on the active account; refresh token first. */
export async function writeTokens(
    accessToken: string,
    refreshToken: string,
): Promise<void> {
    const userId = await getActiveAccountId();
    if (userId === null) {
        return;
    }
    await persistTokenPair(
        { accessToken, refreshToken },
        {
            writeRefreshToken: async (token): Promise<void> => {
                await updateAccount(userId, { refreshToken: token });
            },
            writeAccessToken: async (token): Promise<void> => {
                await updateAccount(userId, { accessToken: token });
            },
        },
    );
}

export async function writeAccessToken(accessToken: string): Promise<void> {
    const userId = await getActiveAccountId();
    if (userId === null) {
        return;
    }
    await updateAccount(userId, { accessToken });
}
