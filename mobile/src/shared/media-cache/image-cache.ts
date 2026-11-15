import { getCacheEntry, putCacheEntry, touchCacheEntry } from './cache-store';
import {
    cachedMediaFile,
    downloadMediaFile,
    type MediaAttachmentRef,
} from './media-file';

/**
 * Full-size image cache: `documents/media-cache/images/<id>.<ext>`.
 * Only images the user opened in the viewer are stored here; bubble
 * thumbnails keep using expo-image's own cache.
 */

const downloads = new Map<number, Promise<string>>();

/** Local `file://` uri when the full-size image is already cached. */
export function getCachedImageUri(
    attachment: MediaAttachmentRef,
): string | null {
    if (attachment.id === null) return null;
    const entry = getCacheEntry('image', attachment.id);
    if (entry !== null) {
        touchCacheEntry('image', attachment.id);
        return entry.path;
    }
    // Adopt a file that survived without its index entry.
    const file = cachedMediaFile('image', attachment);
    if (file !== null && file.exists && (file.size ?? 0) > 0) {
        void putCacheEntry('image', attachment.id, file);
        return file.uri;
    }
    return null;
}

/** Downloads (once) the full-size image; concurrent calls share one promise. */
export function cacheImage(attachment: MediaAttachmentRef): Promise<string> {
    const id = attachment.id;
    if (id === null) {
        return Promise.reject(new Error('This image is still uploading.'));
    }
    const existing = downloads.get(id);
    if (existing !== undefined) return existing;
    const cached = getCachedImageUri(attachment);
    if (cached !== null) return Promise.resolve(cached);

    const promise = (async (): Promise<string> => {
        const file = await downloadMediaFile('image', attachment);
        const entry = await putCacheEntry('image', id, file);
        if (entry === null) {
            throw new Error('The downloaded image is empty.');
        }
        return entry.path;
    })().finally((): void => {
        if (downloads.get(id) === promise) {
            downloads.delete(id);
        }
    });

    downloads.set(id, promise);
    return promise;
}
