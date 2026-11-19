import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
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

// TEMP-WEB-TRACE: browser fallback so the app can boot for live tracing.
const web = Platform.OS === 'web';
const webGet = async (k: string): Promise<string | null> =>
    web ? globalThis.localStorage?.getItem(k) ?? null : SecureStore.getItemAsync(k);
const webSet = async (k: string, v: string): Promise<void> => {
    if (web) globalThis.localStorage?.setItem(k, v);
    else await SecureStore.setItemAsync(k, v);
};
const webDel = async (k: string): Promise<void> => {
    if (web) globalThis.localStorage?.removeItem(k);
    else await SecureStore.deleteItemAsync(k);
};

export async function readAccessToken(): Promise<string | null> {
    return webGet(ACCESS_TOKEN_KEY);
}

export async function readRefreshToken(): Promise<string | null> {
    return webGet(REFRESH_TOKEN_KEY);
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
                webSet(REFRESH_TOKEN_KEY, token),
            writeAccessToken: (token) =>
                webSet(ACCESS_TOKEN_KEY, token),
        },
    );
}

export async function writeAccessToken(accessToken: string): Promise<void> {
    await webSet(ACCESS_TOKEN_KEY, accessToken);
}

export async function clearTokens(): Promise<void> {
    // Refresh token first: a half-finished logout must not leave the long-lived
    // credential behind.
    await webDel(REFRESH_TOKEN_KEY);
    await webDel(ACCESS_TOKEN_KEY);
}
