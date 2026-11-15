import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export const CONTACTS_MATCH_MAX_PHONES = 500;
export const CONTACTS_MATCH_RATE_LIMIT = 10;
export const CONTACTS_MATCH_RATE_WINDOW_SECONDS = 60;

/**
 * Canonicalizes ONE uploaded contact number.
 *
 * The app uploads E.164 strings only, so parsing without a default region is
 * intentional: a local-format number must not be guessed into a country.
 * Anything that does not parse is dropped by the caller, never logged.
 */
export function normalizeContactPhone(raw: unknown): string | null {
    if (typeof raw !== 'string') {
        return null;
    }
    const trimmed = raw.trim();
    if (!trimmed.startsWith('+')) {
        return null;
    }
    const parsed = parsePhoneNumberFromString(trimmed);
    if (parsed === undefined || !parsed.isValid()) {
        return null;
    }
    return parsed.number;
}

/**
 * Validates the request envelope, normalizes every entry and removes
 * duplicates. Unparseable entries are dropped; the caller only ever sees the
 * canonical E.164 values. More than 500 numbers is a 400.
 */
export function normalizeContactPhones(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        throw new BadRequestException(
            'phones must be an array of E.164 strings',
        );
    }
    if (raw.length > CONTACTS_MATCH_MAX_PHONES) {
        throw new BadRequestException(
            `phones must contain at most ${CONTACTS_MATCH_MAX_PHONES} numbers`,
        );
    }
    const unique = new Set<string>();
    for (const value of raw) {
        const phone = normalizeContactPhone(value);
        if (phone !== null) {
            unique.add(phone);
        }
    }
    return [...unique];
}

/** Rate-limit key for the current minute window. */
export function contactsMatchRateKey(userId: number): string {
    const bucket = Math.floor(Date.now() / 60_000);
    return `contacts:match:${userId}:${bucket}`;
}
