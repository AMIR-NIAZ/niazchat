import { mkdirSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

/**
 * Profile picture rules shared by the upload interceptor, the avatar limit
 * guard and the service that persists the stored paths.
 *
 * Only raster image types that every client can decode are accepted: avatars
 * are served statically from the API origin, so an SVG (scriptable) must never
 * end up there.
 */
export const AVATAR_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
] as const;

/** Accepted image extensions, for error messages and file names. */
export const AVATAR_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

/** Hard cap on how many photos one profile may keep. */
export const MAX_USER_AVATARS = 10;

/** Avatar upload size cap (mirrored by the app before it uploads). */
export const AVATAR_MAX_FILE_SIZE = 5 * 1024 * 1024;

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

/** Server-relative path (`uploads/avatars/<name>.<ext>`) for a multer file. */
export function storedAvatarPath(filePath: string): string {
    return relative(process.cwd(), filePath).split(sep).join('/');
}

/**
 * Resolves a stored avatar path to a file inside the avatar directory.
 *
 * Only the basename of the stored value is used, and the result is verified to
 * stay inside `uploads/avatars`. Callers must still have matched the value
 * against the caller's own `avatars` array; this is the last line of defence
 * against a path-traversal entry ending up in the database.
 */
export function resolveAvatarFilePath(stored: string): string | null {
    const directory = ensureAvatarDirectory();
    const fileName = basename(stored);
    if (fileName === '' || fileName === '.' || fileName === '..') {
        return null;
    }
    const candidate = resolve(directory, fileName);
    const inside = relative(directory, candidate);
    if (inside === '' || inside.startsWith('..')) {
        return null;
    }
    return candidate;
}

/**
 * The wire identifier of an avatar is its stored file NAME (basename), never
 * an array index. This normalizes a route param and rejects anything shaped
 * like a path.
 */
export function avatarFileNameOf(
    raw: string | undefined | null,
): string | null {
    const value = (raw ?? '').trim();
    if (value === '' || value === '.' || value === '..') {
        return null;
    }
    if (value !== basename(value)) {
        return null;
    }
    return value;
}
