import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '../../core/api';
import type { UpdateProfilePayloadDto, UserDto } from '../../core/api';
import { absoluteUploadUrl } from '../../core/config/env';
import {
    updateProfile,
    uploadMyAvatar,
    deleteMyAvatar,
} from './profile-service';

/**
 * Current-user server state over TanStack Query:
 * - `ME_QUERY_KEY` caches `GET /auth/getme` (bare `toUserResponse`) — shared
 *   with `use-me.ts`, so every me-reader is a single cache entry.
 * - Mutations invalidate that cache on success; every consumer refetches and
 *   stays in sync (`me.id` is immutable, so callers depending on the id — like
 *   message echo-matching — are unaffected).
 */

/** Same key as `use-me.ts`. */
const ME_QUERY_KEY = ['me'] as const;

function invalidateMe(
    queryClient: ReturnType<typeof useQueryClient>,
): () => Promise<void> {
    return () =>
        queryClient.invalidateQueries({
            queryKey: ME_QUERY_KEY,
        });
}

export interface ProfileView {
    profile: UserDto | null;
    /** Absolute avatar urls (backend paths are server-relative). */
    avatarUrls: string[];
    /** Last path in `avatars` (uploads append — the latest wins). */
    currentAvatarPath: string | null;
}

/**
 * Own profile, fully typed for the UI. Bio/name/username only — there is no
 * email field, no separate first/last name, and presence fields
 * (`isOnline`/`lastSeen`) are broken server-side so they are not surfaced.
 */
export function useProfile(): {
    view: ProfileView;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
} {
    const query = useQuery<UserDto>({
        queryKey: ME_QUERY_KEY,
        queryFn: async (): Promise<UserDto> => {
            const response = await httpClient.get<UserDto>('/auth/getme');
            return response.data;
        },
        retry: false,
        staleTime: 10 * 60 * 1000,
    });

    const profile = query.data ?? null;
    const avatars = profile?.avatars ?? [];

    return {
        view: {
            profile,
            avatarUrls: avatars.map(absoluteUploadUrl),
            currentAvatarPath:
                avatars.length > 0
                    ? (avatars[avatars.length - 1] ?? null)
                    : null,
        },
        isLoading: query.isPending,
        error: query.error instanceof Error ? query.error : null,
        refetch: (): void => {
            void query.refetch();
        },
    };
}

export function useUpdateProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: UpdateProfilePayloadDto): Promise<void> =>
            updateProfile(payload),
        onSuccess: invalidateMe(queryClient),
    });
}

export function useUploadMyAvatar() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (fileUri: string): Promise<void> => uploadMyAvatar(fileUri),
        onSuccess: invalidateMe(queryClient),
    });
}

export function useDeleteMyAvatar() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (avatarPath: string): Promise<void> =>
            deleteMyAvatar({ avatar: avatarPath }),
        onSuccess: invalidateMe(queryClient),
    });
}
