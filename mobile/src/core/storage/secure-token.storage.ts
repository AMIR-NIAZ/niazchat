import * as SecureStore from 'expo-secure-store';
import { persistTokenPair } from '../../features/auth/session-refresh-model';

/**
 * Secure token storage (iOS Keychain / Android EncryptedSharedPreferences).
 *
 * The backend has no logout endpoint; clearing this storage IS the logout.
 *
 * Write order matters: the refresh token is written before the access token so
 * a crash between the two writes can never leave a rotated-away refresh token
 * paired with a new access token. Deletion does the reverse for safety.
 */

const ACCESS_TOKEN_KEY = 'niazchat.accessToken';
const REFRESH_TOKEN_KEY = 'niazchat.refreshToken';

export async function readAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function readRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

/** Persists a login/refresh pair; refresh token is written first. */
export async function writeTokens(
    accessToken: string,
    refreshToken: string,
): Promise<void> {
    await persistTokenPair(
        { accessToken, refreshToken },
        {
            writeRefreshToken: (token) =>
                SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token),
            writeAccessToken: (token) =>
                SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token),
        },
    );
}

export async function writeAccessToken(accessToken: string): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
}

export async function clearTokens(): Promise<void> {
    // Refresh token first: a half-finished logout must not leave the long-lived
    // credential behind.
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
}
