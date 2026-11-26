import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Raw SecureStore access (iOS Keychain / Android EncryptedSharedPreferences).
 *
 * `expo-secure-store` has no web implementation, so the browser build uses
 * localStorage for the same keys. Kept here so the account store and the token
 * store share one implementation and can never disagree about the platform.
 */

const web = Platform.OS === 'web';

/**
 * SecureStore rejects keys with anything outside `[A-Za-z0-9._-]` (and empty
 * keys). Dynamic parts (user ids, emails, ...) must never reach it raw.
 */
const INVALID_KEY_CHARACTERS = /[^A-Za-z0-9._-]/g;
const VALID_KEY = /^[A-Za-z0-9._-]+$/;

function sanitizeKeyPart(part: string | number | null | undefined): string {
    if (part === null || part === undefined) {
        return '';
    }
    return String(part).trim().replace(INVALID_KEY_CHARACTERS, '_');
}

/**
 * Builds a SecureStore-safe key: `<namespace>.<dynamicPart>...`.
 *
 * Every part is sanitized (`[^A-Za-z0-9._-]` → `_`) and must be non-empty, so
 * an unresolved id can never silently collapse into a shared key. This is the
 * ONE place keys are assembled; call it instead of string concatenation.
 */
export function secureKey(
    ...parts: readonly (string | number | null | undefined)[]
): string {
    if (parts.length === 0) {
        throw new Error('SecureStore keys must not be empty.');
    }
    const segments = parts.map(sanitizeKeyPart);
    if (segments.some((segment) => segment === '')) {
        throw new Error('SecureStore key parts must not be empty.');
    }
    return segments.join('.');
}

/** Fails loudly on an invalid key instead of the opaque native error. */
function assertValidKey(key: string): void {
    if (!VALID_KEY.test(key)) {
        throw new Error(
            `Invalid SecureStore key "${key}". Keys must not be empty and may contain only A-Z, a-z, 0-9, ".", "-" and "_".`,
        );
    }
}

export function secureGet(key: string): Promise<string | null> {
    assertValidKey(key);
    return web
        ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null)
        : SecureStore.getItemAsync(key);
}

export async function secureSet(key: string, value: string): Promise<void> {
    assertValidKey(key);
    if (web) {
        globalThis.localStorage?.setItem(key, value);
        return;
    }
    await SecureStore.setItemAsync(key, value);
}

export async function secureDelete(key: string): Promise<void> {
    assertValidKey(key);
    if (web) {
        globalThis.localStorage?.removeItem(key);
        return;
    }
    await SecureStore.deleteItemAsync(key);
}
