import * as SecureStore from 'expo-secure-store';

/**
 * Secure token storage (iOS Keychain / Android EncryptedSharedPreferences).
 *
 * The backend has no logout endpoint; clearing this storage IS the logout.
 */

const ACCESS_TOKEN_KEY = 'niazchat.accessToken';
const REFRESH_TOKEN_KEY = 'niazchat.refreshToken';

export async function readAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function readRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function writeTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function writeAccessToken(accessToken: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}
