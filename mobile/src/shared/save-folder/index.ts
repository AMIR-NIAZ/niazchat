import * as FileSystem from 'expo-file-system/legacy';
import type { SaveFolder } from './folder-grant';
import {
    ensureSaveFolder,
    getSaveFolder,
    resetSaveFolder,
} from './folder-grant';
import type { SafCopyMethod } from './saf-copy';
import {
    copyLocalFileToSaf,
    createSafFile,
    deleteSafFile,
    listSafChildren,
    safFileSize,
} from './saf-copy';

/**
 * Public API for "Save to Downloads" on Android.
 *
 * The attack surface is deliberately small: this module owns the folder grant
 * (see `folder-grant.ts`) and the memory-safe copy (see `saf-copy.ts`), and
 * returns a plain result so the caller decides how to talk about it. It never
 * throws and never leaves a half-written file behind.
 *
 * A future Settings row can read the current target with `getSaveFolder()`
 * ("Save folder: Download/niazChat") and offer `resetSaveFolder()` as "Change".
 */

export { getSaveFolder, resetSaveFolder };
export type { SaveFolder };

export interface SaveFileRequest {
    /** Local `file://` URI of the verified download. */
    sourceUri: string;
    /** File name to use (already sanitized by the caller). */
    fileName: string;
    mimeType: string;
}

export type SaveFileResult =
    | {
          status: 'saved';
          /** Folder as the user sees it, e.g. `Download/niazChat`. */
          label: string;
          /** Final name in that folder (numbered when it already existed). */
          fileName: string;
          /** Which copy strategy worked; useful in the report only. */
          method: SafCopyMethod;
      }
    | { status: 'cancelled' }
    | { status: 'failed'; message: string };

/** Path separators and control characters can never reach the filesystem. */
function safeName(fileName: string): string {
    let result = '';
    for (const char of fileName.replace(/[\\/]/g, ' ')) {
        const code = char.charCodeAt(0);
        if (code >= 0x20 && code !== 0x7f) {
            result += char;
        }
    }
    return result.replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** `photo.jpg` → `photo (1).jpg`. */
function numberedName(fileName: string, index: number): string {
    const dot = fileName.lastIndexOf('.');
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot > 0 ? fileName.slice(dot) : '';
    return `${base} (${index})${extension}`;
}

/** First free name in the folder: existing copies are never overwritten. */
async function uniqueName(dirUri: string, desired: string): Promise<string> {
    const taken = new Set(
        (await listSafChildren(dirUri)).map((child) =>
            child.name.toLowerCase(),
        ),
    );
    let candidate = desired;
    let index = 1;
    while (taken.has(candidate.toLowerCase())) {
        if (index > 999) {
            throw new Error('That folder already holds too many copies.');
        }
        candidate = numberedName(desired, index);
        index += 1;
    }
    return candidate;
}

async function sourceSize(sourceUri: string): Promise<number | null> {
    try {
        const info = await FileSystem.getInfoAsync(sourceUri);
        if (!info.exists || info.isDirectory || info.size <= 0) {
            return null;
        }
        return info.size;
    } catch {
        return null;
    }
}

function megabyteLabel(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function messageOf(error: unknown, fallback: string): string {
    return error instanceof Error && error.message !== ''
        ? error.message
        : fallback;
}

async function writeCopy(
    folder: SaveFolder,
    fileName: string,
    request: SaveFileRequest,
    size: number,
): Promise<SaveFileResult> {
    let destination: string | null = null;
    try {
        destination = await createSafFile(
            folder.targetUri,
            fileName,
            request.mimeType,
        );
        const method = await copyLocalFileToSaf(
            request.sourceUri,
            destination,
            size,
        );
        const written = await safFileSize(destination);
        if (written !== null && written !== size) {
            await deleteSafFile(destination);
            return {
                status: 'failed',
                message: `The copy stopped early (${megabyteLabel(
                    written,
                )} of ${megabyteLabel(size)}).`,
            };
        }
        return {
            status: 'saved',
            label: folder.label,
            fileName,
            method,
        };
    } catch (error) {
        if (destination !== null) {
            await deleteSafFile(destination);
        }
        return {
            status: 'failed',
            message: messageOf(
                error,
                'The file could not be saved to that folder.',
            ),
        };
    }
}

/**
 * Saves a downloaded file into the granted folder (creating `niazChat` inside
 * it), asking for the folder on the first save. The extension and MIME type are
 * preserved so the system classifies the file correctly.
 */
export async function saveFileToDownloads(
    request: SaveFileRequest,
): Promise<SaveFileResult> {
    const fileName = safeName(request.fileName);
    if (fileName === '') {
        return { status: 'failed', message: 'This file has no usable name.' };
    }
    const size = await sourceSize(request.sourceUri);
    if (size === null) {
        return {
            status: 'failed',
            message: 'The downloaded file could not be read. Download it again.',
        };
    }
    let folder: SaveFolder | null;
    try {
        folder = await ensureSaveFolder();
    } catch (error) {
        return {
            status: 'failed',
            message: messageOf(error, 'The save folder is not available.'),
        };
    }
    if (folder === null) {
        return { status: 'cancelled' };
    }
    let target: string;
    try {
        target = await uniqueName(folder.targetUri, fileName);
    } catch (error) {
        return {
            status: 'failed',
            message: messageOf(error, 'That save folder cannot be listed.'),
        };
    }
    return writeCopy(folder, target, request, size);
}
