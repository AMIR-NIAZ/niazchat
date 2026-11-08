import { toNumericId } from '../messages/messages-model';

/**
 * Reads the authenticated user id from an access token, WITHOUT a JWT library.
 *
 * The token is only ever parsed here, never validated (the server validates it
 * on every request). The `sub` claim is the ONE source of truth for "is this
 * message mine?", independent of the profile cache. Ids are normalized to
 * numbers like every other id in the app.
 */

const BASE64URL_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64URL_INDEX: Record<string, number> = {};
for (let index = 0; index < BASE64URL_ALPHABET.length; index += 1) {
    BASE64URL_INDEX[BASE64URL_ALPHABET[index] as string] = index;
}

/** base64url segment (JSON body) → string; null when it is not base64url. */
function decodeBase64Url(segment: string): string | null {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    let buffer = 0;
    let bits = 0;
    let result = '';
    for (const char of base64) {
        if (char === '=') {
            break;
        }
        const value = BASE64URL_INDEX[char];
        if (value === undefined) {
            return null;
        }
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            result += String.fromCharCode((buffer >> bits) & 0xff);
            buffer &= (1 << bits) - 1;
        }
    }
    return result;
}

/** `sub` claim of an access token as a number, or null when unreadable. */
export function accessTokenSubject(
    token: string | null | undefined,
): number | null {
    if (typeof token !== 'string') {
        return null;
    }
    // header.payload.signature — the payload is segment 1.
    const parts = token.split('.');
    const payloadSegment = parts[1];
    if (parts.length < 2 || payloadSegment === undefined) {
        return null;
    }
    const json = decodeBase64Url(payloadSegment);
    if (json === null) {
        return null;
    }
    let payload: unknown;
    try {
        payload = JSON.parse(json);
    } catch {
        return null;
    }
    if (payload === null || typeof payload !== 'object') {
        return null;
    }
    return toNumericId((payload as { sub?: unknown }).sub);
}
