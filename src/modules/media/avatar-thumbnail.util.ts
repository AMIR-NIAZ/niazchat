import * as fs from 'node:fs';
import { join } from 'node:path';

/**
 * Avatar thumbnails.
 *
 * Originals stay exactly where they are (`uploads/avatars/<unique>.<ext>`,
 * served publicly at `/uploads/...`). Thumbnails are generated on demand by
 * `GET /media/avatars/:size/:fileName` and cached on disk under
 * `uploads/thumbs/<size>/<fileName>.webp` — a SIBLING of the originals, so the
 * two file groups never mix and deleting an original can never delete a
 * thumbnail by accident.
 *
 * File names are unique per upload (UUID for users, timestamp+random for
 * groups), so a generated thumbnail is immutable for its file name: it is safe
 * to cache forever and to reuse across restarts.
 */

/** Allowed thumbnail edge sizes. Anything else is rejected with 400. */
export const AVATAR_THUMBNAIL_SIZES = [64, 128, 256] as const;

export type AvatarThumbnailSize = (typeof AVATAR_THUMBNAIL_SIZES)[number];

/** Long-lived cache: the file name changes whenever the photo changes. */
export const AVATAR_THUMBNAIL_CACHE_CONTROL =
    'public, max-age=31536000, immutable';

const SAFE_AVATAR_FILE_NAME =
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.(?:jpe?g|png|webp)$/;

export function isAvatarThumbnailSize(
    value: unknown,
): value is AvatarThumbnailSize {
    return (AVATAR_THUMBNAIL_SIZES as readonly number[]).includes(
        Number(value),
    );
}

/**
 * Strict basename guard for the thumbnail route: no separators, no `..`, no
 * traversal, only the extensions the uploader can produce. `../x.png` and
 * `a/b.png` are rejected before any filesystem access.
 */
export function safeAvatarFileName(
    raw: string | null | undefined,
): string | null {
    const value = (raw ?? '').trim();
    if (value === '' || value.includes('..') || value.includes('/')) {
        return null;
    }
    if (!SAFE_AVATAR_FILE_NAME.test(value)) {
        return null;
    }
    return value;
}

/** Absolute path of the avatar originals directory. */
export function avatarsDirectory(): string {
    return join(process.cwd(), 'uploads', 'avatars');
}

/** Absolute path of one thumbnail (whether or not it exists yet). */
export function avatarThumbnailPath(
    size: AvatarThumbnailSize,
    fileName: string,
): string {
    return join(process.cwd(), 'uploads', 'thumbs', String(size), `${fileName}.webp`);
}

/**
 * Deletes every cached thumbnail of one avatar (best effort, never throws).
 *
 * Called wherever an avatar file is deleted: user avatar delete routes, the
 * legacy delete route, ban housekeeping, and group avatar deletion (group
 * photos share `uploads/avatars`). Thumbnails are derived artefacts — losing
 * the cleanup only costs disk space, never correctness.
 */
export async function removeAvatarThumbnails(
    storedName: string | null | undefined,
): Promise<void> {
    const fileName = safeAvatarFileName(
        (storedName ?? '').split('/').pop() ?? '',
    );
    if (fileName === null) {
        return;
    }
    await Promise.all(
        AVATAR_THUMBNAIL_SIZES.map((size) =>
            fs.promises
                .unlink(avatarThumbnailPath(size, fileName))
                .catch((): void => undefined),
        ),
    );
}
