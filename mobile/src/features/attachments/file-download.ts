import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { attachmentAuthHeaders } from './auth-headers';
import { attachmentUrl } from './attachment-url';
import {
    MAX_FILE_CACHE_BYTES,
    MAX_FILE_CACHE_FILES,
    selectFileCacheEvictions,
} from './file-cache-policy';
import type { CachedFile } from './file-cache-policy';
import { sanitizeFileName } from './file-name';

/**
 * Document cache: `<cache>/files/<attachmentId>/<sanitized original name>`.
 * The authenticated download writes to a temporary file, then renames it, so a
 * partially downloaded file can never be opened. Cache: 200 files / 300 MB.
 */
const active = new Map<number, FileSystem.DownloadResumable>();
let capScheduled = false;

function scheduleCacheCapOnce(): void {
    if (capScheduled) return;
    capScheduled = true;
    void enforceFileCacheCap();
}

function cacheRoot(): string | null {
    return FileSystem.cacheDirectory === null
        ? null
        : `${FileSystem.cacheDirectory}files/`;
}

function attachmentDirectory(id: number): string | null {
    const root = cacheRoot();
    return root === null ? null : `${root}${id}/`;
}

export function cachedAttachmentPath(attachment: {
    id: number;
    name: string;
    mimeType?: string | null;
}): string | null {
    const dir = attachmentDirectory(attachment.id);
    if (dir === null) return null;
    return `${dir}${sanitizeFileName(
        attachment.name,
        attachment.id,
        attachment.mimeType,
    )}`;
}

function partPath(attachment: {
    id: number;
    name: string;
    mimeType?: string | null;
}): string | null {
    const finalPath = cachedAttachmentPath(attachment);
    return finalPath === null ? null : `${finalPath}.part`;
}

export function isAttachmentDownloadActive(id: number): boolean {
    return active.has(id);
}

export function cancelAttachmentDownload(id: number): void {
    const resumable = active.get(id);
    active.delete(id);
    if (resumable === undefined) return;
    void resumable.cancelAsync().catch((): void => undefined);
}

/** Returns the cached path only when the file exists and is non-empty. */
export async function findCachedAttachment(attachment: {
    id: number;
    name: string;
    mimeType?: string | null;
}): Promise<string | null> {
    scheduleCacheCapOnce();
    const path = cachedAttachmentPath(attachment);
    if (path === null) return null;
    try {
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists || info.isDirectory) return null;
        return info.size > 0 ? path : null;
    } catch {
        return null;
    }
}

async function removeQuietly(path: string): Promise<void> {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(
        (): void => undefined,
    );
}

async function runDownload(
    attachmentId: number,
    url: string,
    part: string,
    headers: Record<string, string> | undefined,
    onProgress?: (progress: number) => void,
): Promise<number> {
    const resumable = FileSystem.createDownloadResumable(
        url,
        part,
        { headers: headers ?? {} },
        ({ totalBytesWritten, totalBytesExpectedToWrite }): void => {
            if (totalBytesExpectedToWrite > 0) {
                onProgress?.(
                    Math.min(1, totalBytesWritten / totalBytesExpectedToWrite),
                );
            }
        },
    );
    active.set(attachmentId, resumable);
    try {
        const result = await resumable.downloadAsync();
        if (result === undefined) {
            throw new Error('Download was cancelled.');
        }
        return result.status;
    } finally {
        if (active.get(attachmentId) === resumable) {
            active.delete(attachmentId);
        }
    }
}

/**
 * Downloads (or returns the cached copy of) a document. `onProgress` receives
 * 0..1. Cancellation goes through `cancelAttachmentDownload(id)`.
 */
export async function downloadAttachment(
    attachment: { id: number; name: string; mimeType: string },
    onProgress?: (progress: number) => void,
): Promise<string> {
    const cached = await findCachedAttachment(attachment);
    if (cached !== null) {
        onProgress?.(1);
        return cached;
    }

    const finalPath = cachedAttachmentPath(attachment);
    const part = partPath(attachment);
    const dir = attachmentDirectory(attachment.id);
    if (finalPath === null || part === null || dir === null) {
        throw new Error('File storage is unavailable on this device.');
    }

    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await removeQuietly(part);
    if (await FileSystem.getInfoAsync(finalPath).then((info) => info.exists)) {
        await removeQuietly(finalPath);
    }

    const url = attachmentUrl(attachment.id);
    try {
        let status = await runDownload(
            attachment.id,
            url,
            part,
            await attachmentAuthHeaders(),
            onProgress,
        );
        if (status === 401) {
            await removeQuietly(part);
            status = await runDownload(
                attachment.id,
                url,
                part,
                await attachmentAuthHeaders(true),
                onProgress,
            );
        }
        if (status === 401) {
            throw new Error('Session expired. Try again.');
        }
        if (status !== 200) {
            throw new Error(
                status === 404
                    ? 'This file is no longer available.'
                    : `Download failed (${status}).`,
            );
        }

        const result = await FileSystem.getInfoAsync(part);
        if (!result.exists || result.isDirectory || result.size <= 0) {
            throw new Error('The downloaded file is empty.');
        }
        await FileSystem.moveAsync({ from: part, to: finalPath });
        onProgress?.(1);
        await enforceFileCacheCap();
        return finalPath;
    } catch (error) {
        await removeQuietly(part);
        if (error instanceof Error && error.message.includes('cancel')) {
            throw error;
        }
        throw error instanceof Error ? error : new Error('Download failed.');
    }
}

/** Best-effort cache cleanup for one attachment (all document files). */
export async function deleteCachedAttachment(id: number): Promise<void> {
    cancelAttachmentDownload(id);
    const dir = attachmentDirectory(id);
    if (dir !== null) {
        await removeQuietly(dir);
    }
}

/** Deletes the oldest cached documents until both caps are satisfied. */
export async function enforceFileCacheCap(): Promise<void> {
    const root = cacheRoot();
    if (root === null) return;
    let directories: string[];
    try {
        directories = await FileSystem.readDirectoryAsync(root);
    } catch {
        return;
    }

    const files: CachedFile[] = [];
    for (const name of directories) {
        const dir = `${root}${name}/`;
        let children: string[];
        try {
            children = await FileSystem.readDirectoryAsync(dir);
        } catch {
            continue;
        }
        for (const child of children) {
            if (child.endsWith('.part')) continue;
            const path = `${dir}${child}`;
            try {
                const info = await FileSystem.getInfoAsync(path);
                if (!info.exists || info.isDirectory) continue;
                files.push({
                    path,
                    size: info.size,
                    modifiedMs: info.modificationTime * 1000,
                });
            } catch {
                // A concurrently removed cache entry is already evicted.
            }
        }
    }

    const evicted = selectFileCacheEvictions(
        files,
        MAX_FILE_CACHE_FILES,
        MAX_FILE_CACHE_BYTES,
    );
    await Promise.all(evicted.map((path) => removeQuietly(path)));
}

/** Opens the system share/open sheet for a downloaded local file. */
export async function shareLocalFile(
    path: string,
    mimeType: string,
    dialogTitle?: string,
    uti?: string,
): Promise<void> {
    if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(path, {
        mimeType,
        ...(dialogTitle !== undefined ? { dialogTitle } : {}),
        ...(uti !== undefined ? { UTI: uti } : {}),
    });
}
