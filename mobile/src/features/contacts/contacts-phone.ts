import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

/**
 * Phone helpers for the Contacts tab.
 *
 * Numbers are normalized with `libphonenumber-js` (pure JS, works in Expo Go)
 * BEFORE they leave the device, and only the canonical E.164 form is uploaded.
 * Names, emails and labels never leave the device.
 */

/** Matches the backend limit (`POST /contacts/match`). */
export const CONTACTS_MATCH_BATCH_SIZE = 500;

/**
 * Default region for numbers stored without a country code: the device locale
 * (`fa-IR` → `IR`), falling back to `IR` so `0912…` becomes `+98912…`.
 */
export function deviceDefaultRegion(): CountryCode {
    try {
        const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
        const region = locale.split('-')[1]?.toUpperCase();
        if (region !== undefined && /^[A-Z]{2}$/.test(region)) {
            return region as CountryCode;
        }
    } catch {
        // No Intl locale information: use the fallback below.
    }
    return 'IR';
}

/** Canonical E.164 string, or null when the number does not parse. */
export function normalizePhone(
    raw: string | undefined,
    region: CountryCode,
): string | null {
    if (raw === undefined) {
        return null;
    }
    const trimmed = raw.trim();
    if (trimmed === '') {
        return null;
    }
    const parsed = parsePhoneNumberFromString(trimmed, region);
    if (parsed === undefined || !parsed.isValid()) {
        return null;
    }
    return parsed.number;
}

/** Stable FNV-1a hash of a phone list, used as part of the query key. */
export function hashPhoneList(phones: readonly string[]): string {
    let hash = 0x811c9dc5;
    for (const phone of phones) {
        for (let index = 0; index < phone.length; index += 1) {
            hash ^= phone.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        hash ^= 0x2c;
        hash = Math.imul(hash, 0x01000193);
    }
    return `${(hash >>> 0).toString(16)}-${phones.length}`;
}

/** Splits a list into upload batches of at most `size` entries. */
export function chunkPhones(
    phones: readonly string[],
    size: number = CONTACTS_MATCH_BATCH_SIZE,
): string[][] {
    const batches: string[][] = [];
    for (let index = 0; index < phones.length; index += size) {
        batches.push(phones.slice(index, index + size));
    }
    return batches;
}
