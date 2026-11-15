import { useQuery } from '@tanstack/react-query';
import { httpClient } from '../../core/api';
import type { UserDto } from '../../core/api';
import { normalizeUserPayload } from './me-cache';

/**
 * Own profile (`GET /auth/getme` — bare `toUserResponse`). This is the ONLY
 * fetch for the shared `['me']` entry, so the cache can only ever hold a
 * normalized (numeric `id`), complete user. Ownership checks do NOT read it:
 * they use `useCurrentUserId()` (the session's access-token `sub`).
 */

export const ME_QUERY_KEY = ['me'] as const;

/** `['me']` queryFn shared by `useMe` and `useProfile` (same key, same shape). */
export async function fetchMe(): Promise<UserDto> {
    const response = await httpClient.get<UserDto>('/auth/getme');
    const user = normalizeUserPayload(response.data);
    if (user === null) {
        throw new Error('Your profile response was missing the user id.');
    }
    return user;
}

export function useMe(): {
    me: UserDto | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
} {
    const query = useQuery<UserDto>({
        queryKey: ME_QUERY_KEY,
        queryFn: fetchMe,
        staleTime: 10 * 60 * 1000,
        // A failed `me` never logs out; it retries in the background and then
        // polls every 30 s while the app runs. Cached data is rendered anyway.
        retry: 3,
        retryDelay: (attempt): number =>
            [1_000, 3_000, 8_000][attempt] ?? 30_000,
        refetchInterval: (query): number | false =>
            query.state.status === 'error' ? 30_000 : false,
    });
    return {
        me: query.data ?? null,
        isLoading: query.isPending,
        error: query.error instanceof Error ? query.error : null,
        refetch: (): void => {
            void query.refetch();
        },
    };
}
