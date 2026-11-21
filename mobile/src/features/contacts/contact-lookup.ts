import { absoluteUploadUrl } from '../../core/config/env';
import { matchContacts } from './contacts-service';
import { deviceDefaultRegion, normalizePhone } from './contacts-phone';

/**
 * "Find" step of the Add-contact flow: resolves a phone number to the
 * registered user BEFORE anything is saved.
 *
 * Phone: one `POST /contacts/match` batch with the single normalized number.
 * Only normalized numbers are ever uploaded; the server does not store them.
 */

export interface ContactLookupResult {
    userId: number;
    name: string;
    username: string | null;
    avatarUrl: string | null;
}

export interface PhoneLookup {
    /** Canonical E.164, null when the input is not a valid number. */
    normalized: string | null;
    /** `null` = valid number but no account (or not on the app). */
    user: ContactLookupResult | null;
}

export async function lookupContactByPhone(raw: string): Promise<PhoneLookup> {
    const normalized = normalizePhone(raw, deviceDefaultRegion());
    if (normalized === null) {
        return { normalized: null, user: null };
    }
    const items = await matchContacts([normalized]);
    const match = items.find((item) => item.phone === normalized);
    if (match === undefined) {
        return { normalized, user: null };
    }
    return {
        normalized,
        user: {
            userId: Number(match.userId),
            name: match.name,
            username: match.username,
            avatarUrl: match.avatars[0]
                ? absoluteUploadUrl(match.avatars[0])
                : null,
        },
    };
}
