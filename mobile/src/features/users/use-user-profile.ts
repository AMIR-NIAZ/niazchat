import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../core/api';
import { fetchUserProfile } from './users-service';
import type { PublicUserProfileView } from './public-profile-model';

/**
 * Someone else's public profile (`GET /user/:userId/profile`).
 *
 * One cache entry per user id, shared by every entry point into the screen.
 * Kept separate from `['me']`: this shape deliberately has no phone and the
 * viewer never writes it there. 404/429 are final answers (refetching cannot
 * help), everything else gets a single retry.
 */

export function userProfileQueryKey(userId: number) {
    return ['user', userId] as const;
}

export function useUserProfile(userId: number | null): {
    profile: PublicUserProfileView | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
} {
    const query = useQuery<PublicUserProfileView>({
        queryKey: userProfileQueryKey(userId ?? 0),
        queryFn: (): Promise<PublicUserProfileView> => {
            if (userId === null) {
                return Promise.reject(new Error('Invalid user id.'));
            }
            return fetchUserProfile(userId);
        },
        enabled: userId !== null && userId > 0,
        staleTime: 60_000,
        retry: (failureCount: number, error: Error): boolean => {
            if (
                error instanceof ApiError &&
                (error.statusCode === 404 || error.statusCode === 429)
            ) {
                return false;
            }
            return failureCount < 1;
        },
    });

    return {
        profile: query.data ?? null,
        isLoading: query.isPending,
        error: query.error instanceof Error ? query.error : null,
        refetch: (): void => {
            void query.refetch();
        },
    };
}
