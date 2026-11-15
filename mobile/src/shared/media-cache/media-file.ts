import { File } from 'expo-file-system';
import { attachmentUrl } from '../../features/attachments/attachment-url';
import { attachmentAuthHeaders } from '../../features/attachments/auth-headers';
import { ensureMediaDirectory, mediaDirectory } from './cache-store';
import type { MediaCacheKind } from './cache-store';

/** The minimum an attachment needs for caching (image or video). */
export interface MediaAttachmentRef {
    id: number | null;
    mimeType: string;
    name?: string | undefined;
}
/**
 * One key type for every attachment lookup. Ids reach the app from the wire
 * (where they can still be numeric strings) and from typed DTOs (numbers):
 * normalising here keeps the download entry, the cache index and the React
 * subscription on the same key.
 */
export function toKey(
    id: number | string | null | undefined,
): number | null {
    if (id === null || id === undefined) return null;
    const numeric = typeof id === 'number' ? id : Number(id);
    return Number.isFinite(numeric) ? numeric : null;
}

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/avif': 'avif',
};

const VIDEO_EXTENSION_BY_MIME: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
    'video/3gpp': '3gp',
    'video/x-msvideo': 'avi',
};

function extensionFromName(name: string | undefined): string | null {
    if (name === undefined) return null;
    const dot = name.lastIndexOf('.');
    if (dot < 0 || dot === name.length - 1) return null;
    const extension = name.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,5}$/.test(extension) ? extension : null;
}

export function mediaFileExtension(
    kind: MediaCacheKind,
    attachment: MediaAttachmentRef,
): string {
    const table =
        kind === 'image' ? IMAGE_EXTENSION_BY_MIME : VIDEO_EXTENSION_BY_MIME;
    const byMime = table[attachment.mimeType.toLowerCase()];
    if (byMime !== undefined) return byMime;
    const byName = extensionFromName(attachment.name);
    if (byName !== null) return byName;
    return kind === 'image' ? 'jpg' : 'mp4';
}

/** Final cache file for an attachment, e.g. `documents/media-cache/videos/12.mp4`. */
export function cachedMediaFile(
    kind: MediaCacheKind,
    attachment: MediaAttachmentRef,
): File | null {
    if (attachment.id === null) return null;
    return new File(
        mediaDirectory(kind),
        `${attachment.id}.${mediaFileExtension(kind, attachment)}`,
    );
}

function partFileFor(finalFile: File): File {
    return new File(`${finalFile.uri}.part`);
}

function isUnauthorized(error: unknown): boolean {
    return error instanceof Error && /\b401\b/.test(error.message);
}

interface DownloadOptions {
    onProgress?: ((progress: number) => void) | undefined;
    signal?: AbortSignal | undefined;
}

async function downloadOnce(
    url: string,
    destination: File,
    headers: Record<string, string> | undefined,
    options: DownloadOptions,
): Promise<void> {
    const progress = options.onProgress;
    await File.downloadFileAsync(url, destination, {
        ...(headers !== undefined ? { headers } : {}),
        idempotent: true,
        ...(progress !== undefined
            ? {
                  onProgress: ({
                      bytesWritten,
                      totalBytes,
                  }: {
                      bytesWritten: number;
                      totalBytes: number;
                  }): void => {
                      if (totalBytes > 0) {
                          progress(Math.min(1, bytesWritten / totalBytes));
                      }
                  },
              }
            : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
}

/**
 * Downloads the full attachment through the authenticated download route into
 * a `.part` file and moves it to its final name only after a clean, non-empty
 * download. Returns the final file; throws otherwise (leaving no file behind).
 */
export async function downloadMediaFile(
    kind: MediaCacheKind,
    attachment: MediaAttachmentRef,
    options: DownloadOptions = {},
): Promise<File> {
    if (attachment.id === null) {
        throw new Error('This attachment is still uploading.');
    }
    ensureMediaDirectory(kind);
    const finalFile = cachedMediaFile(kind, attachment);
    if (finalFile === null) {
        throw new Error('File storage is unavailable on this device.');
    }

    const part = partFileFor(finalFile);
    if (part.exists) {
        try {
            part.delete();
        } catch {
            // A stale partial file that cannot be removed is overwritten below.
        }
    }

    const url = attachmentUrl(attachment.id);
    try {
        try {
            await downloadOnce(
                url,
                part,
                await attachmentAuthHeaders(),
                options,
            );
        } catch (error) {
            if (!isUnauthorized(error)) throw error;
            if (part.exists) {
                try {
                    part.delete();
                } catch {
                    // Ignore; the retry overwrites it.
                }
            }
            await downloadOnce(
                url,
                part,
                await attachmentAuthHeaders(true),
                options,
            );
        }

        if (!part.exists || (part.size ?? 0) <= 0) {
            throw new Error('The downloaded file is empty.');
        }
        if (finalFile.exists) {
            try {
                finalFile.delete();
            } catch {
                // moveSync with overwrite handles the remaining case.
            }
        }
        part.moveSync(finalFile, { overwrite: true });
        return finalFile;
    } catch (error) {
        if (part.exists) {
            try {
                part.delete();
            } catch {
                // Best effort: startup cleanup removes any leftover `.part`.
            }
        }
        throw error;
    }
}
