import * as FileSystem from 'expo-file-system/legacy';
import { attachmentUrl } from '../attachments/attachment-url';
import { attachmentAuthHeaders } from '../attachments/auth-headers';
import {
    MAX_VOICE_CACHE_BYTES,
    MAX_VOICE_CACHE_FILES,
    selectVoiceEvictions,
} from './cache-policy';
import type { CachedVoiceFile } from './cache-policy';

/**
 * Voice playback cache: complete files under `<cache>/voice/`, downloaded once
 * with the Bearer header and replayed from disk afterwards (offline included).
 * The cache is capped at 100 files / 100 MB (oldest evicted first).
 */

const EXT_BY_MIME: Record<string, string> = {
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
};

export class VoiceDownloadError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

function directory(): string | null {
    return FileSystem.cacheDirectory === null
        ? null
        : `${FileSystem.cacheDirectory}voice/`;
}

export function voiceCachePath(
    attachmentId: number,
    mimeType: string,
): string | null {
    const dir = directory();
    if (dir === null) return null;
    const extension = EXT_BY_MIME[mimeType.toLowerCase()] ?? 'm4a';
    return `${dir}${attachmentId}.${extension}`;
}

export async function deleteVoiceFile(uri: string): Promise<void> {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(
        (): void => undefined,
    );
}

async function downloadTo(
    partPath: string,
    attachmentId: number,
    headers: Record<string, string> | undefined,
    onProgress?: (progress: number) => void,
): Promise<void> {
    const resumable = FileSystem.createDownloadResumable(
        attachmentUrl(attachmentId),
        partPath,
        { headers: headers ?? {} },
        ({ totalBytesWritten, totalBytesExpectedToWrite }): void => {
            if (totalBytesExpectedToWrite > 0) {
                onProgress?.(
                    Math.min(1, totalBytesWritten / totalBytesExpectedToWrite),
                );
            }
        },
    );
    const result = await resumable.downloadAsync();
    if (result === undefined) {
        throw new Error('Download was cancelled.');
    }
    if (result.status === 401) {
        throw new VoiceDownloadError(401, 'Session expired. Try again.');
    }
    if (result.status !== 200) {
        throw new Error(`Download failed (${result.status}).`);
    }
}

/** Downloads the voice file once; later plays return the cached path. */
export async function ensureVoiceCached(
    attachmentId: number,
    mimeType: string,
    onProgress?: (progress: number) => void,
): Promise<string> {
    const dir = directory();
    const finalPath = voiceCachePath(attachmentId, mimeType);
    if (dir === null || finalPath === null) {
        throw new Error('File storage is unavailable on this device.');
    }

    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const existing = await FileSystem.getInfoAsync(finalPath);
    if (existing.exists && existing.size > 0) {
        onProgress?.(1);
        return finalPath;
    }

    const partPath = `${finalPath}.part`;
    await FileSystem.deleteAsync(partPath, { idempotent: true }).catch(
        (): void => undefined,
    );

    try {
        await downloadTo(
            partPath,
            attachmentId,
            await attachmentAuthHeaders(),
            onProgress,
        );
    } catch (error) {
        if (error instanceof VoiceDownloadError && error.status === 401) {
            await downloadTo(
                partPath,
                attachmentId,
                await attachmentAuthHeaders(true),
                onProgress,
            );
        } else {
            await FileSystem.deleteAsync(partPath, {
                idempotent: true,
            }).catch((): void => undefined);
            throw error;
        }
    }

    await FileSystem.moveAsync({ from: partPath, to: finalPath });
    onProgress?.(1);
    await enforceVoiceCacheCap();
    return finalPath;
}

/** Deletes the oldest voice files until both caps are satisfied. */
export async function enforceVoiceCacheCap(): Promise<void> {
    const dir = directory();
    if (dir === null) return;
    let names: string[];
    try {
        names = await FileSystem.readDirectoryAsync(dir);
    } catch {
        return;
    }
    const files: CachedVoiceFile[] = [];
    for (const name of names) {
        if (name.endsWith('.part')) {
            files.push({ path: `${dir}${name}`, size: 0, modifiedMs: 0 });
            continue;
        }
        const path = `${dir}${name}`;
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) continue;
        files.push({
            path,
            size: 'size' in info ? info.size : 0,
            modifiedMs:
                ('modificationTime' in info ? info.modificationTime : 0) * 1000,
        });
    }
    const evicted = selectVoiceEvictions(
        files,
        MAX_VOICE_CACHE_FILES,
        MAX_VOICE_CACHE_BYTES,
    );
    await Promise.all(evicted.map((path) => deleteVoiceFile(path)));
}
