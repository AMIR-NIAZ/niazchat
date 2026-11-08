/**
 * Application environment configuration.
 *
 * Expo exposes plain environment variables prefixed with EXPO_PUBLIC_
 * through `process.env` at build/dev time.
 */

const FALLBACK_API_URL = 'http://192.168.100.10:3000';

function readUrl(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = raw.trim().replace(/\/+$/, '');
  const isHttpUrl = value.startsWith('http://') || value.startsWith('https://');
  if (!isHttpUrl) {
    throw new Error(`${name} must be an http(s) URL (got: ${raw}). Check .env / .env.example.`);
  }
  return value;
}

const apiUrl = readUrl('EXPO_PUBLIC_API_URL', FALLBACK_API_URL);

export const env = {
  /** REST base URL (no trailing slash, no /api prefix — backend controllers live at root). */
  apiUrl,
  /** Socket.IO origin. Backend has no namespace; same host as the REST API by default. */
  wsUrl: readUrl('EXPO_PUBLIC_WS_URL', apiUrl),
  /** Base URL for statically served avatars ("uploads/avatars/..." paths live here). */
  uploadsBaseUrl: readUrl('EXPO_PUBLIC_UPLOADS_BASE_URL', `${apiUrl}/uploads`),
} as const;

/**
 * Converts a server-relative avatar path into an absolute URL.
 *
 * The backend stores paths already rooted at the static mount
 * (`uploads/avatars/<name>.png`, see `docs/mobile-api/users.md`) and serves
 * them under `/uploads` — which is exactly what `uploadsBaseUrl` points at. The
 * mount segment is therefore stripped before joining: without this the URL
 * becomes `/uploads/uploads/avatars/...` and every avatar 404s.
 */
export function absoluteUploadUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const normalized = path.replace(/^\/+/, '').replace(/^uploads\//, '');
  return `${env.uploadsBaseUrl}/${normalized}`;
}

/** Thumbnail edge sizes the backend generates (`GET /media/avatars/:size/:fileName`). */
export const AVATAR_THUMB_SIZES = [64, 128, 256] as const;

export type AvatarThumbSize = (typeof AVATAR_THUMB_SIZES)[number];

/** File name of an avatar path/URL, or null when it is not a raster image. */
export function avatarFileNameOf(path: string | null | undefined): string | null {
  const value = (path ?? '').trim();
  if (value === '') {
    return null;
  }
  const withoutQuery = value.split('?')[0] ?? '';
  const fileName = withoutQuery.split('/').pop() ?? '';
  return /\.(?:jpe?g|png|webp)$/i.test(fileName) ? fileName : null;
}

/**
 * Smallest server-generated size that covers `requestedPx` device pixels
 * (capped at the largest allowed size), so a 32 px circle never downloads the
 * original and a 96 px one is never upscaled from 64.
 */
export function pickAvatarThumbSize(
  requestedPx: number,
  pixelRatio: number = 1,
): AvatarThumbSize {
  const needed = Math.ceil(Math.max(1, requestedPx) * Math.max(1, pixelRatio));
  return AVATAR_THUMB_SIZES.find((size) => size >= needed) ?? 256;
}

/**
 * Resized, long-cacheable avatar URL for a small circle.
 *
 * Takes the server-relative path stored on the wire (`uploads/avatars/x.png`) or
 * an absolute uploads URL, keeps only the file name (file names are unique per
 * upload) and points it at the thumbnail route. Returns null when there is no
 * usable path, so callers render the initials fallback instead of requesting
 * the original.
 */
export function avatarThumbUrl(
  path: string | null | undefined,
  requestedPx: number,
  pixelRatio: number = 1,
): string | null {
  const fileName = avatarFileNameOf(path);
  if (fileName === null) {
    return null;
  }
  const size = pickAvatarThumbSize(requestedPx, pixelRatio);
  return `${env.apiUrl}/media/avatars/${size}/${encodeURIComponent(fileName)}`;
}
