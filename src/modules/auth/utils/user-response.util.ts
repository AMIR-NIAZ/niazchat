import { User } from '../entities/user.entity';
import { UserProfile } from '../entities/user_profile.entity';

type UserWithOptionalProfile = Omit<User, 'profile'> & {
    profile?: UserProfile | null;
};

export function toUserResponse(user: UserWithOptionalProfile) {
    const profile = user.profile;

    return {
        id: user.id,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        phone: user.phone,
        name: profile?.name ?? 'بدون نام',
        biografy: profile?.biografy ?? null,
        username: profile?.username ?? null,
        avatars: profile?.avatars ?? [],
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        status: user.status,
        ...(user.role ? { role: user.role } : {}),
    };
}
