import { useCallback, useEffect, useState } from 'react';
import { getApiTokenProvider, hasApiTokenProvider } from '../../core/api';

export type AuthHeaders = Record<string, string>;

/**
 * Fresh `Authorization` header for image/download requests.
 *
 * `forceRefresh` performs ONE refresh-token round-trip (same mechanism the
 * HTTP client uses) before returning the header. Used after a 401 from
 * expo-image or a download.
 */
export async function attachmentAuthHeaders(
    forceRefresh = false,
): Promise<AuthHeaders | undefined> {
    if (!hasApiTokenProvider()) {
        return undefined;
    }
    const provider = getApiTokenProvider();
    let token: string | null = null;
    if (forceRefresh) {
        // Shared single-flight refresh (never a second parallel round-trip).
        await provider.ensureFreshSession();
        const result = await provider.refreshSession();
        if (result.status === 'rejected') {
            provider.onSessionRejected();
            return undefined;
        }
        if (result.status === 'ok') {
            token = result.accessToken;
        }
    }
    token ??= await provider.getAccessToken();
    return token === null ? undefined : { Authorization: `Bearer ${token}` };
}

/**
 * Shared auth-header hook: one fetch per mount, plus a `refresh` function for
 * the tap-to-reload path after an image 401. The image cache key is the URL,
 * so a token change never triggers a refetch by itself.
 */
export function useAttachmentAuth(): {
    headers: AuthHeaders | undefined;
    refresh: () => Promise<AuthHeaders | undefined>;
} {
    const [headers, setHeaders] = useState<AuthHeaders | undefined>(undefined);

    useEffect((): (() => void) => {
        let cancelled = false;
        void attachmentAuthHeaders().then((next): void => {
            if (!cancelled && next !== undefined) {
                setHeaders(next);
            }
        });
        return (): void => {
            cancelled = true;
        };
    }, []);

    const refresh = useCallback(async (): Promise<AuthHeaders | undefined> => {
        let next = await attachmentAuthHeaders(true);
        if (next === undefined) {
            next = await attachmentAuthHeaders(false);
        }
        if (next !== undefined) {
            setHeaders(next);
        }
        return next;
    }, []);

    return { headers, refresh };
}
