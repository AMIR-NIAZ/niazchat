import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { File, FileMode, Paths } from 'expo-file-system';
import { attachmentAuthHeaders } from '../../features/attachments/auth-headers';
import { attachmentUrl } from '../../features/attachments/attachment-url';
import {
    dropCacheEntry,
    ensureMediaDirectory,
    getCacheEntry,
    initMediaCache,
    listCacheEntries,
    mediaDirectory,
    ORPHAN_PART_MAX_AGE_MS,
    putCacheEntry,
    touchCacheEntry,
} from './cache-store';
import {
    cachedMediaFile,
    mediaFileExtension,
    toKey,
    type MediaAttachmentRef,
} from './media-file';

/**
 * Telegram-style video downloads.
 *
 * A video is playable only after the complete file has been downloaded and its
 * byte size verified; there is no streaming from the remote URL. Files live in
 * the persistent media cache (never the OS-purgeable cache directory):
 *
 *   documents/media-cache/videos/<id>.part        in-flight download
 *   documents/media-cache/videos/<id>.<ext>       verified, playable file
 *
 * State machine (per attachment id):
 *
 *   idle ──start──▶ queued ──slot free──▶ downloading ──verified──▶ verifying
 *                    │                       │  ▲                        │
 *                    │                    pause │resume                   ▼
 *                    │                       ▼  │                      ready
 *                    └────cancel──▶ idle    paused
 *   downloading ──error──▶ error ──retry──▶ queued
 *
 * State lives OUTSIDE React (module Map + per-attachment listeners), so a
 * progress tick re-renders only the tile that subscribes — never the message
 * list. Updates are throttled to ~10/s.
 */

export type VideoDownloadState =
    | 'idle'
    | 'queued'
    | 'downloading'
    | 'paused'
    | 'verifying'
    | 'ready'
    | 'error';

export interface VideoDownloadSnapshot {
    state: VideoDownloadState;
    /** 0..1 (0 while the total size is unknown). */
    progress: number;
    receivedBytes: number;
    totalBytes: number;
    error: string | null;
    /** Local `file://` URI, only ever set in the `ready` state. */
    localUri: string | null;
}

/** What the downloader needs from an attachment. */
export interface VideoDownloadAttachment extends MediaAttachmentRef {
    /** DTO size in bytes, when known (used for verification + resume). */
    size?: number | undefined;
}

/** At most two files download at once, the rest wait in FIFO order. */
export const MAX_CONCURRENT_VIDEO_DOWNLOADS = 2;

const PROGRESS_THROTTLE_MS = 100;
const MAX_DOWNLOAD_ATTEMPTS = 3;
const MAX_SIZE_MISMATCH_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 3000, 8000] as const;
const APPEND_CHUNK_BYTES = 1024 * 1024;
const FREE_SPACE_MARGIN_BYTES = 16 * 1024 * 1024;

const IDLE_SNAPSHOT: VideoDownloadSnapshot = {
    state: 'idle',
    progress: 0,
    receivedBytes: 0,
    totalBytes: 0,
    error: null,
    localUri: null,
};

interface Entry {
    attachment: VideoDownloadAttachment & { id: number };
    snapshot: VideoDownloadSnapshot;
    receivedBytes: number;
    totalBytes: number;
    lastEmitAt: number;
    emitTimer: ReturnType<typeof setTimeout> | null;
    controller: AbortController | null;
    active: boolean;
    settled: Promise<void> | null;
    resolveSettled: (() => void) | null;
    cancelRequested: boolean;
    pauseRequested: boolean;
}

const entries = new Map<number, Entry>();
/**
 * Listeners live NEXT TO the entries, not inside them: a bubble subscribes on
 * mount, before any download entry exists. Keeping the listener set on the
 * entry meant `subscribe` found no entry and returned a no-op unsubscribe, so
 * the download that was started later never reached the already-mounted UI
 * (frozen progress ring, and a bubble that only turned `ready` after a
 * restart re-created its entries).
 */
const listeners = new Map<number, Set<() => void>>();
/** Ids already probed and not cached, so renders do not stat the disk again. */
const missingProbes = new Set<number>();
const queue: number[] = [];
let activeDownloads = 0;
let initialized: Promise<void> | null = null;

// ── snapshots + subscriptions ───────────────────────────────────────────────

function notify(id: number): void {
    const set = listeners.get(id);
    if (set === undefined) return;
    for (const listener of set) {
        listener();
    }
}

function emit(entry: Entry): void {
    notify(entry.attachment.id);
}

function progressPatch(entry: Entry): Partial<VideoDownloadSnapshot> {
    const total = entry.totalBytes;
    return {
        progress: total > 0 ? Math.min(1, entry.receivedBytes / total) : 0,
        receivedBytes: entry.receivedBytes,
        totalBytes: total,
    };
}

/**
 * Emits the latest bytes immediately when a throttled update is still pending,
 * so a state transition can never overtake (or drop) the progress it followed.
 */
function flushPendingProgress(entry: Entry): void {
    if (entry.emitTimer === null) return;
    clearTimeout(entry.emitTimer);
    entry.emitTimer = null;
    if (entry.snapshot.state !== 'downloading') return;
    entry.lastEmitAt = Date.now();
    entry.snapshot = { ...entry.snapshot, ...progressPatch(entry) };
    emit(entry);
}

/**
 * Replaces the snapshot with a NEW immutable object and notifies exactly this
 * attachment's subscribers (a fresh reference is what makes
 * `useSyncExternalStore` re-render; in-place mutation never would).
 */
function setSnapshot(
    entry: Entry,
    patch: Partial<VideoDownloadSnapshot>,
): void {
    flushPendingProgress(entry);
    entry.snapshot = { ...entry.snapshot, ...patch };
    emit(entry);
}

function clearEmitTimer(entry: Entry): void {
    if (entry.emitTimer !== null) {
        clearTimeout(entry.emitTimer);
        entry.emitTimer = null;
    }
}

function flushProgress(entry: Entry): void {
    entry.emitTimer = null;
    if (entry.snapshot.state !== 'downloading') return;
    entry.lastEmitAt = Date.now();
    entry.snapshot = { ...entry.snapshot, ...progressPatch(entry) };
    emit(entry);
}

/** ~10 UI updates per second while bytes arrive. */
function reportProgress(
    entry: Entry,
    receivedBytes: number,
    totalBytes: number,
): void {
    entry.receivedBytes = receivedBytes;
    if (totalBytes > 0) {
        entry.totalBytes = totalBytes;
    }
    const elapsed = Date.now() - entry.lastEmitAt;
    if (elapsed >= PROGRESS_THROTTLE_MS) {
        flushProgress(entry);
        return;
    }
    if (entry.emitTimer === null) {
        entry.emitTimer = setTimeout((): void => {
            flushProgress(entry);
        }, PROGRESS_THROTTLE_MS - elapsed);
    }
}

/**
 * Subscribes to one attachment's download. Works before any download entry
 * exists, so a bubble mounted ahead of its download still gets every state
 * change and every throttled progress tick.
 */
export function subscribeVideoDownload(
    id: number | null,
    listener: () => void,
): () => void {
    const key = toKey(id);
    if (key === null) return (): void => undefined;
    return subscribe(key, listener);
}

function subscribe(id: number, listener: () => void): () => void {
    let set = listeners.get(id);
    if (set === undefined) {
        set = new Set();
        listeners.set(id, set);
    }
    set.add(listener);
    return (): void => {
        const current = listeners.get(id);
        if (current === undefined) return;
        current.delete(listener);
        if (current.size === 0) listeners.delete(id);
    };
}

function attachmentRef(
    attachment: VideoDownloadAttachment & { id: number },
): VideoDownloadAttachment & { id: number } {
    return {
        id: attachment.id,
        mimeType: attachment.mimeType,
        ...(attachment.name !== undefined ? { name: attachment.name } : {}),
        ...(attachment.size !== undefined ? { size: attachment.size } : {}),
    };
}

function ensureEntry(
    attachment: VideoDownloadAttachment & { id: number },
): Entry {
    const existing = entries.get(attachment.id);
    if (existing !== undefined) {
        existing.attachment = attachmentRef(attachment);
        return existing;
    }
    const entry: Entry = {
        attachment: attachmentRef(attachment),
        snapshot: IDLE_SNAPSHOT,
        receivedBytes: 0,
        totalBytes:
            attachment.size !== undefined && attachment.size > 0
                ? attachment.size
                : 0,
        lastEmitAt: 0,
        emitTimer: null,
        controller: null,
        active: false,
        settled: null,
        resolveSettled: null,
        cancelRequested: false,
        pauseRequested: false,
    };
    entries.set(attachment.id, entry);
    return entry;
}

/** Local `file://` uri of a fully downloaded video, if the index says so. */
function cachedVideoUri(attachment: VideoDownloadAttachment): string | null {
    const id = toKey(attachment.id);
    if (id === null) return null;
    const entry = getCacheEntry('video', id);
    if (entry !== null) {
        touchCacheEntry('video', id);
        return entry.path;
    }
    // Adopt a file that survived without its index entry.
    const file = cachedMediaFile('video', attachment);
    if (file !== null && file.exists && (file.size ?? 0) > 0) {
        void putCacheEntry('video', id, file);
        return file.uri;
    }
    return null;
}

/**
 * Current snapshot without subscribing (the popup copy and the initial render
 * use this). The first call for an attachment checks the durable cache so a
 * video downloaded days ago is `ready` immediately.
 */
export function getVideoDownloadSnapshot(
    attachment: MediaAttachmentRef,
): VideoDownloadSnapshot {
    const id = toKey(attachment.id);
    if (id === null) return IDLE_SNAPSHOT;
    const entry = entries.get(id);
    // Same reference while nothing changed (required by useSyncExternalStore).
    if (entry !== undefined) return entry.snapshot;
    if (missingProbes.has(id)) return IDLE_SNAPSHOT;
    const cached = cachedVideoUri(attachment);
    if (cached === null) {
        missingProbes.add(id);
        return IDLE_SNAPSHOT;
    }
    missingProbes.delete(id);
    const created = ensureEntry({
        id,
        mimeType: attachment.mimeType,
        ...(attachment.name !== undefined ? { name: attachment.name } : {}),
    });
    const size = (() => {
        try {
            return new File(cached).size ?? 0;
        } catch {
            return 0;
        }
    })();
    created.receivedBytes = size;
    created.totalBytes = size;
    created.snapshot = {
        state: 'ready',
        progress: 1,
        receivedBytes: size,
        totalBytes: size,
        error: null,
        localUri: cached,
    };
    return created.snapshot;
}

function markReady(entry: Entry, uri: string, size: number): void {
    clearEmitTimer(entry);
    missingProbes.delete(entry.attachment.id);
    entry.receivedBytes = size;
    entry.totalBytes = size;
    entry.snapshot = {
        state: 'ready',
        progress: 1,
        receivedBytes: size,
        totalBytes: size,
        error: null,
        localUri: uri,
    };
    emit(entry);
}

/** Local URI of a ready video (`null` for anything else, including `.part`). */
export function getLocalVideoUri(id: number | null): string | null {
    const key = toKey(id);
    if (key === null) return null;
    const entry = entries.get(key);
    if (entry === undefined || entry.snapshot.state !== 'ready') return null;
    const uri = entry.snapshot.localUri;
    if (uri === null) return null;
    return fileExists(uri) ? uri : null;
}

function settle(entry: Entry): void {
    const resolve = entry.resolveSettled;
    entry.resolveSettled = null;
    entry.settled = null;
    resolve?.();
}

function removeFromQueue(id: number): void {
    const index = queue.indexOf(id);
    if (index >= 0) queue.splice(index, 1);
}

function pump(): void {
    while (
        activeDownloads < MAX_CONCURRENT_VIDEO_DOWNLOADS &&
        queue.length > 0
    ) {
        const nextId = queue.shift();
        if (nextId === undefined) break;
        const entry = entries.get(nextId);
        if (entry === undefined) continue;
        if (entry.active) continue;
        if (entry.snapshot.state !== 'queued') continue;
        if (entry.cancelRequested || entry.pauseRequested) continue;
        void runDownload(entry);
    }
}

// ── file helpers ────────────────────────────────────────────────────────────

function fileExists(uri: string): boolean {
    try {
        const file = new File(uri);
        return file.exists && (file.size ?? 0) > 0;
    } catch {
        return false;
    }
}

function removeFile(file: File): void {
    try {
        if (file.exists) file.delete();
    } catch {
        // Already gone or not deletable; the download overwrites it anyway.
    }
}

function sizeOf(file: File): number {
    try {
        return file.exists ? (file.size ?? 0) : 0;
    } catch {
        return 0;
    }
}

/** Copies `source` to the end of `target` in bounded chunks. */
async function appendFile(source: File, target: File): Promise<void> {
    const reader = source.open(FileMode.ReadOnly);
    const writer = target.open(FileMode.Append);
    try {
        for (;;) {
            const bytes = await reader.readBytes(APPEND_CHUNK_BYTES);
            if (bytes.length === 0) break;
            await writer.writeBytes(bytes);
        }
    } finally {
        reader.close();
        writer.close();
    }
}

class SizeMismatchError extends Error {
    constructor() {
        super('The downloaded video has the wrong size.');
    }
}

class StorageError extends Error {}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error('Download failed.');
}

function isUnauthorized(error: Error): boolean {
    return /\b401\b/.test(error.message);
}

function isCancellation(error: Error): boolean {
    return error.name === 'AbortError' || /abort|cancel/i.test(error.message);
}

function userFacingError(error: Error): string {
    if (isUnauthorized(error)) {
        return 'Session expired. Tap Retry.';
    }
    if (/\b404\b/.test(error.message)) {
        return 'This video is no longer available.';
    }
    if (/ENOSPC|no space|not enough (free )?storage/i.test(error.message)) {
        return 'Not enough free storage to download this video.';
    }
    if (/permission|EACCES|EPERM/i.test(error.message)) {
        return 'Storage access was denied. Check the app’s storage permission.';
    }
    return 'Download failed. Tap Retry.';
}

function delay(ms: number): Promise<void> {
    return new Promise<void>((resolve): void => {
        setTimeout(resolve, ms);
    });
}

function removeStaleParts(directory: ReturnType<typeof mediaDirectory>): void {
    try {
        for (const item of directory.list()) {
            if (!(item instanceof File)) continue;
            if (!item.name.includes('.part')) continue;
            const modified = item.lastModified ?? 0;
            if (modified < Date.now() - ORPHAN_PART_MAX_AGE_MS) {
                removeFile(item);
            }
        }
    } catch {
        // The directory vanished or cannot be listed; nothing to clean.
    }
}

// ── download pipeline ───────────────────────────────────────────────────────

interface AttemptResult {
    /** Bytes in the final `.part` file after this attempt. */
    partBytes: number;
    /** Total file size learned from the response body, 0 when unknown. */
    responseTotal: number;
}

async function downloadAttempt(
    entry: Entry,
    part: File,
    rangeFile: File,
    offset: number,
    expectedBytes: number,
): Promise<AttemptResult> {
    const attachment = entry.attachment;
    const resuming = offset > 0;
    const destination = resuming ? rangeFile : part;
    removeFile(destination);

    const headers = await attachmentAuthHeaders();
    const rangeHeaders: Record<string, string> = {
        ...(headers ?? {}),
        Range: `bytes=${offset}-`,
    };
    const controller = new AbortController();
    entry.controller = controller;
    let responseTotal = 0;

    try {
        await File.downloadFileAsync(
            attachmentUrl(attachment.id),
            destination,
            {
                headers: resuming ? rangeHeaders : (headers ?? {}),
                idempotent: true,
                signal: controller.signal,
                onProgress: ({
                    bytesWritten,
                    totalBytes,
                }: {
                    bytesWritten: number;
                    totalBytes: number;
                }): void => {
                    if (totalBytes > 0) responseTotal = totalBytes;
                    const received = offset + bytesWritten;
                    const total =
                        expectedBytes > 0
                            ? expectedBytes
                            : totalBytes > 0
                              ? offset + totalBytes
                              : 0;
                    reportProgress(entry, received, total);
                },
            },
        );
    } finally {
        if (entry.controller === controller) {
            entry.controller = null;
        }
    }

    const downloaded = sizeOf(destination);
    if (downloaded <= 0) {
        throw new Error('The downloaded video is empty.');
    }

    if (!resuming) {
        return {
            partBytes: downloaded,
            responseTotal: responseTotal > 0 ? responseTotal : downloaded,
        };
    }

    // A full-size body means the server ignored the Range header: use it as is.
    if (downloaded === expectedBytes) {
        removeFile(part);
        destination.moveSync(part, { overwrite: true });
        return { partBytes: downloaded, responseTotal: downloaded };
    }
    if (expectedBytes > 0 && offset + downloaded !== expectedBytes) {
        throw new SizeMismatchError();
    }
    if (
        expectedBytes === 0 &&
        responseTotal > 0 &&
        downloaded !== responseTotal
    ) {
        throw new SizeMismatchError();
    }

    await appendFile(destination, part);
    removeFile(destination);
    return {
        partBytes: sizeOf(part),
        responseTotal: expectedBytes > 0 ? expectedBytes : offset + downloaded,
    };
}

async function downloadToPart(entry: Entry): Promise<void> {
    const attachment = entry.attachment;
    const id = attachment.id;
    const directory = ensureMediaDirectory('video');
    const part = new File(directory, `${id}.part`);
    const rangeFile = new File(directory, `${id}.part.range`);
    const finalFile = cachedMediaFile('video', attachment);
    if (finalFile === null) {
        throw new Error('This video is still uploading.');
    }

    const knownSize =
        attachment.size !== undefined && attachment.size > 0
            ? attachment.size
            : 0;
    let expectedBytes = knownSize;
    let offset = 0;

    if (sizeOf(part) > 0) {
        const existing = sizeOf(part);
        // Resume only when the expected size is known and the partial is short.
        if (expectedBytes > 0 && existing < expectedBytes) {
            offset = existing;
            entry.receivedBytes = existing;
            entry.totalBytes = expectedBytes;
        } else {
            removeFile(part);
        }
    }
    removeFile(rangeFile);

    const available = Paths.availableDiskSpace;
    if (
        expectedBytes > 0 &&
        available > 0 &&
        available < expectedBytes - offset + FREE_SPACE_MARGIN_BYTES
    ) {
        throw new StorageError(
            'Not enough free storage to download this video.',
        );
    }

    let authRetried = false;
    let failures = 0;
    let sizeRetries = 0;

    for (;;) {
        if (entry.cancelRequested || entry.pauseRequested) return;
        try {
            const result = await downloadAttempt(
                entry,
                part,
                rangeFile,
                offset,
                expectedBytes,
            );
            if (expectedBytes === 0) {
                expectedBytes = result.responseTotal;
            }
            if (expectedBytes > 0 && result.partBytes !== expectedBytes) {
                throw new SizeMismatchError();
            }
            if (result.partBytes <= 0) {
                throw new Error('The downloaded video is empty.');
            }

            // Size verified: show a very short verifying phase, then a single
            // atomic rename. Nothing before this point is ever playable.
            flushPendingProgress(entry);
            entry.receivedBytes = expectedBytes;
            entry.totalBytes = expectedBytes;
            setSnapshot(entry, {
                state: 'verifying',
                progress: 1,
                receivedBytes: expectedBytes,
                totalBytes: expectedBytes,
                error: null,
                localUri: null,
            });
            removeFile(finalFile);
            part.moveSync(finalFile, { overwrite: true });
            const cacheEntry = await putCacheEntry('video', id, finalFile);
            if (cacheEntry === null) {
                throw new Error('The downloaded video is empty.');
            }
            markReady(entry, cacheEntry.path, cacheEntry.size);
            return;
        } catch (caught) {
            const error = toError(caught);
            if (entry.cancelRequested || entry.pauseRequested) return;
            if (isCancellation(error)) return;

            if (isUnauthorized(error) && !authRetried) {
                authRetried = true;
                continue;
            }
            if (error instanceof StorageError) throw error;

            if (error instanceof SizeMismatchError) {
                // Never keep bytes that failed verification.
                removeFile(part);
                removeFile(rangeFile);
                offset = 0;
                sizeRetries += 1;
                if (sizeRetries > MAX_SIZE_MISMATCH_RETRIES) throw error;
                continue;
            }

            failures += 1;
            if (failures >= MAX_DOWNLOAD_ATTEMPTS) throw error;

            // Connection lost: pause visibly, then auto-resume with backoff and
            // continue from the bytes already on disk.
            flushPendingProgress(entry);
            setSnapshot(entry, {
                state: 'paused',
                error: null,
                receivedBytes: entry.receivedBytes,
            });
            await delay(RETRY_DELAYS_MS[failures - 1] ?? 8000);
            if (entry.cancelRequested || entry.pauseRequested) return;

            const onDisk = sizeOf(part);
            offset =
                expectedBytes > 0 && onDisk > 0 && onDisk < expectedBytes
                    ? onDisk
                    : 0;
            if (offset === 0) removeFile(part);
            entry.receivedBytes = offset;
            setSnapshot(entry, { state: 'downloading' });
        }
    }
}

async function runDownload(entry: Entry): Promise<void> {
    entry.active = true;
    activeDownloads += 1;
    clearEmitTimer(entry);
    setSnapshot(entry, {
        state: 'downloading',
        progress:
            entry.totalBytes > 0 ? entry.receivedBytes / entry.totalBytes : 0,
        receivedBytes: entry.receivedBytes,
        totalBytes: entry.totalBytes,
        error: null,
        localUri: null,
    });

    try {
        await downloadToPart(entry);
        if (entry.snapshot.state !== 'ready') {
            // Cancelled/paused mid-flight: the `.part` is kept for resuming.
            clearEmitTimer(entry);
            setSnapshot(entry, {
                state: entry.pauseRequested ? 'paused' : 'idle',
                error: null,
                localUri: null,
            });
        }
    } catch (caught) {
        const error = toError(caught);
        clearEmitTimer(entry);
        if (entry.cancelRequested) {
            setSnapshot(entry, {
                state: 'idle',
                error: null,
                localUri: null,
            });
        } else if (entry.pauseRequested) {
            setSnapshot(entry, {
                state: 'paused',
                error: null,
                localUri: null,
            });
        } else if (error instanceof SizeMismatchError) {
            removeFile(
                new File(
                    ensureMediaDirectory('video'),
                    `${entry.attachment.id}.part`,
                ),
            );
            setSnapshot(entry, {
                state: 'error',
                progress: 0,
                receivedBytes: 0,
                error: 'The downloaded video is incomplete. Tap Retry.',
                localUri: null,
            });
        } else {
            setSnapshot(entry, {
                state: 'error',
                error: userFacingError(error),
                localUri: null,
            });
        }
    } finally {
        entry.active = false;
        entry.controller = null;
        activeDownloads = Math.max(0, activeDownloads - 1);
        settle(entry);
        pump();
    }
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Starts (or joins) the download of a video. Resolves once the download settled
 * — success, failure or cancellation — and never rejects, so UI taps can call
 * it fire-and-forget. Callers that need the file check `getLocalVideoUri`.
 */
export function startVideoDownload(
    attachment: VideoDownloadAttachment,
): Promise<void> {
    const id = toKey(attachment.id);
    if (id === null) return Promise.resolve();
    const entry = ensureEntry({ ...attachment, id });
    missingProbes.delete(id);
    if (entry.snapshot.state === 'ready') {
        // Re-verify: the file may have been evicted since it became ready.
        if (
            entry.snapshot.localUri !== null &&
            fileExists(entry.snapshot.localUri)
        ) {
            return Promise.resolve();
        }
        entry.snapshot = IDLE_SNAPSHOT;
    }
    if (entry.settled !== null) return entry.settled;

    const cached = cachedVideoUri(attachment);
    if (cached !== null) {
        const size = sizeOf(new File(cached));
        entry.receivedBytes = size;
        entry.totalBytes = size;
        markReady(entry, cached, size);
        return Promise.resolve();
    }

    entry.cancelRequested = false;
    entry.pauseRequested = false;
    entry.settled = new Promise<void>((resolve): void => {
        entry.resolveSettled = resolve;
    });
    clearEmitTimer(entry);
    entry.snapshot = {
        state: 'queued',
        progress: 0,
        receivedBytes: entry.receivedBytes,
        totalBytes: entry.totalBytes,
        error: null,
        localUri: null,
    };
    emit(entry);
    if (!queue.includes(id)) {
        queue.push(id);
    }
    pump();
    return entry.settled;
}

/** Stops a download and forgets its queue slot; the `.part` is kept. */
export function cancelVideoDownload(id: number): void {
    const key = toKey(id);
    if (key === null) return;
    const entry = entries.get(key);
    if (entry === undefined) return;
    if (entry.snapshot.state === 'ready') return;
    entry.cancelRequested = true;
    entry.pauseRequested = false;
    removeFromQueue(key);
    entry.controller?.abort();
    if (!entry.active) {
        clearEmitTimer(entry);
        setSnapshot(entry, {
            state: 'idle',
            progress: 0,
            error: null,
            localUri: null,
        });
        settle(entry);
    }
}

/** Pauses a download, keeping the `.part` for a manual resume. */
export function pauseVideoDownload(id: number): void {
    const key = toKey(id);
    if (key === null) return;
    const entry = entries.get(key);
    if (entry === undefined) return;
    if (entry.snapshot.state === 'ready') return;
    entry.pauseRequested = true;
    entry.cancelRequested = false;
    removeFromQueue(key);
    entry.controller?.abort();
    if (!entry.active) {
        clearEmitTimer(entry);
        setSnapshot(entry, {
            state: 'paused',
            error: null,
            localUri: null,
        });
        settle(entry);
    }
}

/** Resumes a paused download (same as `start`, kept for a symmetric API). */
export function resumeVideoDownload(
    attachment: VideoDownloadAttachment,
): Promise<void> {
    return startVideoDownload(attachment);
}

/** Clears an error and starts over (resuming from `.part` when possible). */
export function retryVideoDownload(
    attachment: VideoDownloadAttachment,
): Promise<void> {
    return startVideoDownload(attachment);
}

/**
 * Re-reads the disk after the app returns to the foreground (or after a
 * player error): a `ready` entry whose file vanished becomes `idle`.
 */
export function syncVideoDownloadFromDisk(id: number): void {
    const key = toKey(id);
    if (key === null) return;
    const entry = entries.get(key);
    if (entry === undefined || entry.snapshot.state !== 'ready') return;
    const uri = entry.snapshot.localUri;
    if (uri !== null && fileExists(uri)) return;
    dropCacheEntry('video', key);
    clearEmitTimer(entry);
    entry.receivedBytes = 0;
    entry.snapshot = {
        state: 'idle',
        progress: 0,
        receivedBytes: 0,
        totalBytes: entry.totalBytes,
        error: null,
        localUri: null,
    };
    emit(entry);
}

function syncReadyEntriesFromDisk(): void {
    for (const [id, entry] of entries) {
        if (entry.snapshot.state === 'ready') {
            syncVideoDownloadFromDisk(id);
        }
    }
}

function markIndexedFilesReady(): void {
    for (const cacheEntry of listCacheEntries('video')) {
        const uri = cacheEntry.path;
        const id = (() => {
            const match = /(\d+)\./.exec(uri.slice(uri.lastIndexOf('/') + 1));
            return match === null ? null : Number(match[1]);
        })();
        if (id === null || !Number.isFinite(id)) continue;
        if (entries.get(id)?.snapshot.state === 'ready') continue;
        markReadyWithoutAttachment(id, uri, cacheEntry.size);
    }
}

function markReadyWithoutAttachment(
    id: number,
    uri: string,
    size: number,
): void {
    const entry = ensureEntry({ id, mimeType: 'video/mp4' });
    entry.receivedBytes = size;
    entry.totalBytes = size;
    entry.snapshot = {
        state: 'ready',
        progress: 1,
        receivedBytes: size,
        totalBytes: size,
        error: null,
        localUri: uri,
    };
    emit(entry);
}

let appStateSubscription: { remove: () => void } | null = null;

/**
 * App-start housekeeping (idempotent): prune stale partials, mark verified
 * files `ready` before the first bubble renders, and re-check ready files when
 * the app comes back to the foreground.
 */
export function initVideoDownloader(): Promise<void> {
    if (initialized !== null) return initialized;
    initialized = (async (): Promise<void> => {
        try {
            await initMediaCache();
            const directory = mediaDirectory('video');
            if (directory.exists) {
                removeStaleParts(directory);
            }
            // initMediaCache adopted complete files; mark them playable.
            markIndexedFilesReady();
        } catch {
            // Best effort: the cache simply starts empty.
        }
        if (appStateSubscription === null) {
            appStateSubscription = AppState.addEventListener(
                'change',
                (status): void => {
                    if (status === 'active') syncReadyEntriesFromDisk();
                },
            );
        }
    })();
    return initialized;
}

/** Test/teardown helper: forgets all in-memory state (files stay on disk). */
export function resetVideoDownloaderForTests(): void {
    for (const entry of entries.values()) {
        clearEmitTimer(entry);
    }
    entries.clear();
    listeners.clear();
    queue.length = 0;
    activeDownloads = 0;
    initialized = null;
    appStateSubscription?.remove();
    appStateSubscription = null;
}

// ── React binding ───────────────────────────────────────────────────────────

export interface VideoDownloadControls {
    state: VideoDownloadState;
    progress: number;
    receivedBytes: number;
    totalBytes: number;
    error: string | null;
    localUri: string | null;
    start: () => void;
    cancel: () => void;
    retry: () => void;
}

/**
 * Subscribes ONE component to one attachment's download. Pass `live: false`
 * for the popup copy: it shows the current overlay state without subscribing,
 * so the static bubble never re-renders on progress.
 */
export function useVideoDownload(
    attachment: VideoDownloadAttachment,
    options: { live?: boolean } = {},
): VideoDownloadControls {
    const live = options.live ?? true;
    const id = toKey(attachment.id);
    const mimeType = attachment.mimeType;
    const name = attachment.name;
    const size = attachment.size;

    const subscribeToEntry = useCallback(
        (listener: () => void): (() => void) => {
            if (!live) return (): void => undefined;
            return subscribeVideoDownload(id, listener);
        },
        [live, id],
    );

    const readSnapshot = useCallback((): VideoDownloadSnapshot => {
        if (id === null) return IDLE_SNAPSHOT;
        return getVideoDownloadSnapshot({
            id,
            mimeType,
            ...(name !== undefined ? { name } : {}),
        });
    }, [id, mimeType, name]);

    const snapshot = useSyncExternalStore(
        subscribeToEntry,
        readSnapshot,
        readSnapshot,
    );

    // Prime the durable-cache lookup once (state stays outside React).
    useEffect((): void => {
        if (!live || id === null) return;
        getVideoDownloadSnapshot({
            id,
            mimeType,
            ...(name !== undefined ? { name } : {}),
        });
    }, [live, id, mimeType, name]);

    const start = useCallback((): void => {
        void startVideoDownload({
            id,
            mimeType,
            ...(name !== undefined ? { name } : {}),
            ...(size !== undefined ? { size } : {}),
        });
    }, [id, mimeType, name, size]);

    const cancel = useCallback((): void => {
        if (id !== null) cancelVideoDownload(id);
    }, [id]);

    const retry = useCallback((): void => {
        void retryVideoDownload({
            id,
            mimeType,
            ...(name !== undefined ? { name } : {}),
            ...(size !== undefined ? { size } : {}),
        });
    }, [id, mimeType, name, size]);

    return {
        ...snapshot,
        start,
        cancel,
        retry,
    };
}
