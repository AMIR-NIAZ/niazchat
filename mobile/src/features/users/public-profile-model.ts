import type { PublicUserProfileDto } from '../../core/api';

/**
 * Domain model for the user-info screen (someone else's public profile).
 *
 * `avatars[0]` is the current photo (backend convention). Each avatar keeps its
 * stored file NAME next to its render URL: only the file name identifies a photo
 * on the wire, and the viewer is the only place that loads the original.
 */

export interface PublicProfileAvatar {
    /** Stored file name (`x.png`) — stable key, and the thumbnail route's id. */
    fileName: string;
    /** Absolute URL of the ORIGINAL file, used only by the full-screen viewer. */
    url: string;
    /** Server-relative path as stored (`uploads/avatars/x.png`). */
    storedPath: string;
}

export interface PublicUserProfileView {
    /** Numeric — bigint ids may arrive as strings. */
    id: number;
    name: string;
    username: string | null;
    biografy: string | null;
    /** Every photo, current first. */
    avatars: PublicProfileAvatar[];
    isOnline: boolean;
    lastSeen: string | null;
}

/** Last path segment of a stored avatar path (absolute or server-relative). */
export function avatarNameOf(path: string): string {
    const withoutQuery = path.split('?')[0] ?? '';
    const parts = withoutQuery.split('/');
    return parts[parts.length - 1] ?? path;
}

/**
 * "online" / "last seen 5 minutes ago" / null (nothing to show): presence is
 * hidden entirely when the user has never been seen.
 */
export function presenceLabel(
    profile: Pick<PublicUserProfileView, 'isOnline' | 'lastSeen'>,
    now: number = Date.now(),
): string | null {
    if (profile.isOnline) {
        return 'online';
    }
    if (profile.lastSeen === null) {
        return null;
    }
    const relative = formatRelativeTime(profile.lastSeen, now);
    return relative === null ? null : `last seen ${relative}`;
}

/** Compact relative timestamp; null when the value is not a valid date. */
export function formatRelativeTime(
    iso: string,
    now: number = Date.now(),
): string | null {
    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) {
        return null;
    }
    const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
    if (seconds < 60) {
        return 'just now';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    const days = Math.round(hours / 24);
    if (days === 1) {
        return 'yesterday';
    }
    if (days < 7) {
        return `${days} days ago`;
    }
    const date = new Date(timestamp);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${date.getFullYear()}`;
}

/**
 * Normalizes the wire payload into the UI model. Throws when the id is not
 * numeric (a malformed answer must not be cached as a user).
 */
export function toPublicProfileView(
    raw: PublicUserProfileDto,
    toAbsoluteUrl: (path: string) => string,
): PublicUserProfileView {
    const id = Number(raw.id);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('The profile response was missing a valid user id.');
    }
    const avatars = (raw.avatars ?? []).map(
        (storedPath): PublicProfileAvatar => ({
            fileName: avatarNameOf(storedPath),
            url: toAbsoluteUrl(storedPath),
            storedPath,
        }),
    );

    return {
        id,
        name: raw.name,
        username: raw.username,
        biografy: raw.biografy,
        avatars,
        isOnline: raw.isOnline === true,
        lastSeen: raw.lastSeen,
    };
}
