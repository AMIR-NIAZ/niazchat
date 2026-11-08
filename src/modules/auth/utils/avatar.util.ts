import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Profile picture rules shared by the upload interceptor and the service that
 * persists the stored path.
 *
 * Only raster image types are accepted: avatars are served statically from the
 * API origin, so an SVG (scriptable) must never end up there.
 */
export const AVATAR_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
] as const;

/** Accepted image extensions, for error messages and file names. */
export const AVATAR_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

export function isAvatarMimeType(mime: string): boolean {
    return (AVATAR_MIME_TYPES as readonly string[]).includes(
        mime.toLowerCase(),
    );
}

/** Absolute path of the avatar storage directory, created if missing. */
export function ensureAvatarDirectory(): string {
    const directory = join(process.cwd(), 'uploads', 'avatars');
    mkdirSync(directory, { recursive: true });
    return directory;
}
