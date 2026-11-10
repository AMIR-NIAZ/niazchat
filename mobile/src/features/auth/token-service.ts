import axios from 'axios';
import { env } from '../../core/config/env';
import {
    readAccessToken,
    writeTokens,
} from '../../core/storage/secure-token.storage';
import { classifyRefreshStatus } from './session-refresh-model';

/**
 * Token transport + in-memory mirror.
 *
 * The refresh call runs on a bare axios instance (never the app client) so it
 * cannot recurse through the 401 interceptor, and it uses the backend's raw
 * `token` header (NOT `Authorization`).
 */

/** Refresh round-trip timeout: after this the result is `unavailable`. */
export const REFRESH_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Last access token known to memory. Kept in sync with SecureStore so a burst
 * of requests does not re-read the keychain and a just-refreshed token is used
 * immediately by requests that started earlier.
 */
let cachedAccessToken: string | null = null;

export function setCachedAccessToken(token: string | null): void {
    cachedAccessToken = token;
}

export function forgetCachedTokens(): void {
    cachedAccessToken = null;
}

/** Current access token (memory first, then SecureStore). */
export async function getAccessToken(): Promise<string | null> {
    if (cachedAccessToken !== null) {
        return cachedAccessToken;
    }
    const stored = await readAccessToken();
    cachedAccessToken = stored;
    return stored;
}

/** Definitive rejection vs transient failure of one refresh call. */
export type RefreshRequestFailureKind = 'rejected' | 'unavailable';

export class RefreshRequestFailure extends Error {
    readonly kind: RefreshRequestFailureKind;

    constructor(kind: RefreshRequestFailureKind, message: string) {
        super(message);
        this.name = 'RefreshRequestFailure';
        this.kind = kind;
    }
}

export interface RefreshedTokens {
    accessToken: string;
    /** Only set when the server rotated the refresh token. */
    newRefreshToken: string | null;
}

/**
 * One `POST /auth/refresh-token`. Throws `RefreshRequestFailure` whose `kind`
 * is the caller-facing classification. A 200 without an access token is
 * treated as transient (never logs the user out).
 */
export async function requestRefreshedTokens(
    refreshToken: string,
    signal?: AbortSignal,
): Promise<RefreshedTokens> {
    try {
        const response = await axios.post<unknown>(
            `${env.apiUrl}/auth/refresh-token`,
            null,
            {
                headers: { token: refreshToken },
                timeout: REFRESH_REQUEST_TIMEOUT_MS,
                ...(signal !== undefined ? { signal } : {}),
            },
        );
        const body = response.data as
            | { accessToken?: unknown; refreshToken?: unknown }
            | null
            | undefined;
        const accessToken = body?.accessToken;
        if (typeof accessToken !== 'string' || accessToken.trim() === '') {
            throw new RefreshRequestFailure(
                'unavailable',
                'The refresh response did not contain an access token.',
            );
        }
        const rotated = body?.refreshToken;
        return {
            accessToken,
            newRefreshToken:
                typeof rotated === 'string' && rotated !== '' ? rotated : null,
        };
    } catch (error) {
        if (error instanceof RefreshRequestFailure) {
            throw error;
        }
        if (axios.isAxiosError(error)) {
            const status = error.response?.status ?? null;
            throw new RefreshRequestFailure(
                classifyRefreshStatus(status),
                status === null
                    ? 'Could not reach the server.'
                    : `Refresh request failed (${status}).`,
            );
        }
        throw new RefreshRequestFailure(
            'unavailable',
            'Refresh request failed.',
        );
    }
}

/** Persists a refreshed pair and updates the in-memory access token. */
export async function storeRefreshedTokens(
    accessToken: string,
    refreshToken: string,
): Promise<void> {
    await writeTokens(accessToken, refreshToken);
    cachedAccessToken = accessToken;
}
