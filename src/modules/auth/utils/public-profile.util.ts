import { User } from '../entities/user.entity';
import { UserProfile } from '../entities/user_profile.entity';

type UserWithOptionalProfile = Omit<User, 'profile'> & {
    profile?: UserProfile | null;
};

/**
 * The ONLY public projection of a user, for viewing someone else's profile.
 *
 * Deliberately not `toUserResponse`: that one carries `phone`, timestamps,
 * `status` and (when loaded) `role`. This one is exactly what a stranger is
 * allowed to see, and the pick here is the whitelist — nothing internal can
 * leak by adding a column later.
 */
export interface PublicUserProfile {
    id: number;
    name: string;
    username: string | null;
    biografy: string | null;
    /** Every photo, current first (`avatars[0]`), as stored server-relative paths. */
    avatars: string[];
    isOnline: boolean;
    lastSeen: Date | null;
}

export function toPublicUserProfile(
    user: UserWithOptionalProfile,
): PublicUserProfile {
    const profile = user.profile;

    return {
        id: Number(user.id),
        name: profile?.name ?? 'بدون نام',
        username: profile?.username ?? null,
        biografy: profile?.biografy ?? null,
        // Copy: the caller's response must never share the entity's array.
        avatars: [...(profile?.avatars ?? [])],
        isOnline: user.isOnline === true,
        lastSeen: user.lastSeen ?? null,
    };
}
