import { TOKEN_EXPIRY_MARGIN_SECONDS } from './session-refresh-model';

/**
 * Unverified JWT payload helpers, used only for local scheduling decisions
 * (when to refresh proactively, whether a stored access token is still worth
 * using). The server is the only authority: any 401 always triggers a refresh
 * regardless of what `exp` says.
 */

const BASE64URL_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64URL_INDEX: Record<string, number> = {};
for (let index = 0; index < BASE64URL_ALPHABET.length; index += 1) {
    BASE64URL_INDEX[BASE64URL_ALPHABET[index] as string] = index;
}

/** base64url segment → string; null when it is not valid base64url. */
export function decodeBase64Url(segment: string): string | null {
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

/** Parses `header.payload.signature` payload JSON; null when unreadable. */
export function decodeJwtPayload(
    token: string | null | undefined,
): Record<string, unknown> | null {
    if (typeof token !== 'string') {
        return null;
    }
    const parts = token.split('.');
    const payloadSegment = parts[1];
    if (parts.length < 2 || payloadSegment === undefined) {
        return null;
    }
    const json = decodeBase64Url(payloadSegment);
    if (json === null) {
        return null;
    }
    try {
        const payload: unknown = JSON.parse(json);
        return payload !== null && typeof payload === 'object'
            ? (payload as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/**
 * Access-token expiry in **milliseconds** since epoch, or null when the token
 * is missing/malformed/has no numeric `exp`. Never verifies the signature.
 */
export function getTokenExpiry(
    token: string | null | undefined,
): number | null {
    const payload = decodeJwtPayload(token);
    const exp = payload?.exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) {
        return null;
    }
    return exp * 1000;
}

export interface ExpiryOptions {
    /** Clock skew allowance; a token expiring within it counts as expired. */
    marginSeconds?: number;
    nowMs?: number;
}

/**
 * `true` when the token is missing, unreadable, or expires within the margin
 * (60 s by default). Unreadable tokens are treated as expired on purpose.
 */
export function isTokenExpired(
    token: string | null | undefined,
    options: ExpiryOptions = {},
): boolean {
    const marginSeconds = options.marginSeconds ?? TOKEN_EXPIRY_MARGIN_SECONDS;
    const nowMs = options.nowMs ?? Date.now();
    const expiryMs = getTokenExpiry(token);
    if (expiryMs === null) {
        return true;
    }
    return expiryMs - nowMs <= marginSeconds * 1000;
}
