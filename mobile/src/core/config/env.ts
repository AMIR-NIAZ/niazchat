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

/** Converts a server-relative avatar path ("uploads/avatars/…") into an absolute URL. */
export function absoluteUploadUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const normalized = path.replace(/^\/+/, '');
  return `${env.uploadsBaseUrl}/${normalized}`;
}
