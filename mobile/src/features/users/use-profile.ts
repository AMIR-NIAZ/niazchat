import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateProfilePayloadDto, UserDto } from '../../core/api';
import { absoluteUploadUrl } from '../../core/config/env';
import {
    updateProfile,
    uploadAvatar,
    deleteAvatar,
    setMainAvatar,
} from './profile-service';
import type { AvatarUploadAsset } from './profile-service';
import { mergeMeCache } from './me-cache';
import { fetchMe, ME_QUERY_KEY } from './use-me';

/**
 * Current-user server state over TanStack Query:
 * - `ME_QUERY_KEY` caches `GET /auth/getme` (bare `toUserResponse`) — shared
 *   with `use-me.ts`, so every me-reader is a single cache entry.
 * - Every write goes through `mergeMeCache`: the cache never holds a partial
 *   user and its `id` is never replaced. The message cache is deliberately NOT
 *   touched by profile changes — the chat screen reads "is this mine?" from the
 *   session id, and sender name/avatar refresh with the chat's own next fetch.
 * - Avatar mutations merge their response (a complete user) into the cache and
 *   invalidate the profile, the chat list and chat info.
 */

export interface ProfileAvatar {
    /** Stored file NAME — the wire identifier used by mutate actions. */
    fileName: string;
    /** Absolute URL for rendering. */
    url: string;
}

export interface ProfileView {
    profile: UserDto | null;
    /** `avatars[0]` is the current photo (first item here). */
    avatars: ProfileAvatar[];
    currentAvatarUrl: string | null;
}

/** Stored path → file name (`uploads/avatars/x.png` → `x.png`). */
export function avatarFileName(storedPath: string): string {
    const parts = storedPath.split('/');
    return parts[parts.length - 1] ?? storedPath;
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
        // Same queryFn as `useMe`: the shared entry is always normalized.
        queryFn: fetchMe,
        retry: false,
        staleTime: 10 * 60 * 1000,
    });

    const profile = query.data ?? null;
    const avatars = (profile?.avatars ?? []).map(
        (storedPath): ProfileAvatar => ({
            fileName: avatarFileName(storedPath),
            url: absoluteUploadUrl(storedPath),
        }),
    );

    return {
        view: {
            profile,
            avatars,
            currentAvatarUrl: avatars[0]?.url ?? null,
        },
        isLoading: query.isPending,
        error: query.error instanceof Error ? query.error : null,
        refetch: (): void => {
            void query.refetch();
        },
    };
}

/**
 * Merges a profile/avatar response into the shared `['me']` entry. Never
 * replaces it with a partial object: fields the response omits and the id
 * survive. A response that carries no complete user leaves the cache untouched.
 */
function mergeIntoMeCache(
    queryClient: ReturnType<typeof useQueryClient>,
    response: unknown,
): void {
    const previous = queryClient.getQueryData<UserDto>(ME_QUERY_KEY) ?? null;
    const next = mergeMeCache(previous, response);
    if (next !== null) {
        queryClient.setQueryData<UserDto>(ME_QUERY_KEY, next);
    }
}

/** Refreshes every cache that can render my name/avatar (never the messages). */
async function refreshAvatarDependents(
    queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
        queryClient.invalidateQueries({ queryKey: ['chat-info'] }),
    ]);
}

export function useUpdateProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (
            payload: UpdateProfilePayloadDto,
        ): Promise<UserDto | null> => updateProfile(payload),
        onSuccess: async (user): Promise<void> => {
            // `PUT /user/updateme` answers `{ message }` only today; if it ever
            // returns a user, merge it instead of writing it raw. The `['me']`
            // invalidation then lets the normalized server value win.
            if (user !== null) {
                mergeIntoMeCache(queryClient, user);
            }
            await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
        },
    });
}

export function useUploadMyAvatar() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (asset: AvatarUploadAsset): Promise<UserDto | null> =>
            uploadAvatar(asset),
        onSuccess: async (user): Promise<void> => {
            // The mutation response carries the persisted profile: seed the
            // shared entry so the new avatar shows immediately, then refresh
            // everything that renders avatars.
            if (user !== null) {
                mergeIntoMeCache(queryClient, user);
            }
            await refreshAvatarDependents(queryClient);
        },
    });
}

export function useDeleteMyAvatar() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (fileName: string): Promise<UserDto | null> =>
            deleteAvatar(fileName),
        onSuccess: async (user): Promise<void> => {
            if (user !== null) {
                mergeIntoMeCache(queryClient, user);
            }
            await refreshAvatarDependents(queryClient);
        },
    });
}

export function useSetMainAvatar() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (fileName: string): Promise<UserDto | null> =>
            setMainAvatar(fileName),
        onSuccess: async (user): Promise<void> => {
            if (user !== null) {
                mergeIntoMeCache(queryClient, user);
            }
            await refreshAvatarDependents(queryClient);
        },
    });
}
