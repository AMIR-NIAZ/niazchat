import { useQuery } from '@tanstack/react-query';
import { httpClient } from '../../core/api';
import { toNumericId } from '../messages';
import type { UserDto } from '../../core/api';

/**
 * Own profile (`GET /auth/getme` — bare `toUserResponse`). Only the id is
 * consumed by the messaging UI (mine/other bubble direction, echo matching);
 * name/avatar come from message senders and chat info.
 */

export const ME_QUERY_KEY = ['me'] as const;

export function useMe(): {
    me: UserDto | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
} {
    const query = useQuery<UserDto>({
        queryKey: ME_QUERY_KEY,
        queryFn: async (): Promise<UserDto> => {
            const response = await httpClient.get<UserDto>('/auth/getme');
            // SINGLE SOURCE OF TRUTH: user ids, like message sender ids, may
            // arrive as bigint STRINGS ("2") — normalize to a number here,
            // once, so bubble direction and echo matching compare numbers.
            const id = toNumericId(response.data?.id);
            return id === null ? response.data : { ...response.data, id };
        },
        retry: false,
        staleTime: 10 * 60 * 1000,
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
