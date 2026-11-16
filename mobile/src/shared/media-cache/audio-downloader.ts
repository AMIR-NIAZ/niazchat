import { useCallback, useSyncExternalStore } from 'react';
import { File } from 'expo-file-system';
import {
    dropCacheEntry,
    getCacheEntry,
    initMediaCache,
    listCacheEntries,
    putCacheEntry,
    setMediaPlaying,
    touchCacheEntry,
} from './cache-store';
import {
    downloadMediaFile,
    toKey,
    type MediaAttachmentRef,
} from './media-file';

/**
 * Music downloads (Telegram-style): a track is playable only once the whole
 * file is on disk, then it plays from that local file. Files live in the
 * persistent media cache:
 *
 *   documents/media-cache/audio/<id>.part     in-flight download
 *   documents/media-cache/audio/<id>.<ext>    verified, playable file
 *
 * State lives outside React (module Map + per-track listeners), so a progress
 * tick re-renders only the bubble or bar that subscribes — never the list.
 */

export type AudioDownloadState = 'idle' | 'downloading' | 'ready' | 'error';

export interface AudioDownloadSnapshot {
    state: AudioDownloadState;
    /** 0..1 (0 while the total size is unknown). */
    progress: number;
    receivedBytes: number;
    totalBytes: number;
    error: string | null;
    /** Local `file://` URI, only ever set in the `ready` state. */
    localUri: string | null;
}

export interface AudioDownloadAttachment extends MediaAttachmentRef {
    /** DTO size in bytes, when known (used for verification). */
    size?: number | undefined;
}

export interface AudioDownloadControls {
    start: () => void;
    cancel: () => void;
    /** Clears the error and downloads again. */
    retry: () => void;
}

/** One track downloads at a time (tracks can be 100 MB); FIFO queue. */
export const MAX_CONCURRENT_AUDIO_DOWNLOADS = 1;

const PROGRESS_THROTTLE_MS = 100;

const IDLE_SNAPSHOT: AudioDownloadSnapshot = {
    state: 'idle',
    progress: 0,
    receivedBytes: 0,
    totalBytes: 0,
    error: null,
    localUri: null,
};

interface Entry {
    attachment: AudioDownloadAttachment & { id: number };
    snapshot: AudioDownloadSnapshot;
    lastEmitAt: number;
    controller: AbortController | null;
    settled: Promise<string> | null;
    resolveSettled: ((uri: string) => void) | null;
    rejectSettled: ((error: Error) => void) | null;
    cancelRequested: boolean;
}

const entries = new Map<number, Entry>();
/** Listeners live next to the entries so bubbles can subscribe before a download. */
const listeners = new Map<number, Set<() => void>>();
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
    entry.lastEmitAt = Date.now();
    notify(entry.attachment.id);
}

function setSnapshot(
    entry: Entry,
    patch: Partial<AudioDownloadSnapshot>,
): void {
    entry.snapshot = { ...entry.snapshot, ...patch };
    emit(entry);
}

export function subscribeAudioDownload(
    id: number,
    listener: () => void,
): () => void {
    let set = listeners.get(id);
    if (set === undefined) {
        set = new Set();
        listeners.set(id, set);
    }
    set.add(listener);
    return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
    };
}

function readySnapshot(uri: string, size: number): AudioDownloadSnapshot {
    return {
        state: 'ready',
        progress: 1,
        receivedBytes: size,
        totalBytes: size,
        error: null,
        localUri: uri,
    };
}

/**
 * Adopts a file that is already in the cache index into the in-memory entry,
 * so the first render of a downloaded track does not hit the disk again.
 */
function adoptCached(id: number, attachment?: AudioDownloadAttachment): Entry {
    const entry = entryFor(
        attachment !== undefined && typeof attachment.id === 'number'
            ? { ...attachment, id: attachment.id }
            : { id, mimeType: '' },
    );
    const cached = getCacheEntry('audio', id);
    if (cached !== null) {
        entry.snapshot = readySnapshot(cached.path, cached.size);
    }
    return entry;
}

export function getAudioDownloadSnapshot(
    attachment: AudioDownloadAttachment,
): AudioDownloadSnapshot {
    const key = toKey(attachment.id);
    if (key === null) return IDLE_SNAPSHOT;
    const entry = entries.get(key);
    if (entry !== undefined) return entry.snapshot;
    if (getCacheEntry('audio', key) !== null) {
        return adoptCached(key, attachment).snapshot;
    }
    return IDLE_SNAPSHOT;
}

export function getLocalAudioUri(id: number | string | null): string | null {
    const key = toKey(id);
    if (key === null) return null;
    const entry = entries.get(key) ?? adoptCached(key);
    return entry.snapshot.state === 'ready' ? entry.snapshot.localUri : null;
}

/**
 * Subscribes a bubble to one track. Progress updates only re-render the
 * component that calls this hook for that attachment id.
 */
export function useAudioDownload(
    attachment: AudioDownloadAttachment,
): AudioDownloadSnapshot & AudioDownloadControls {
    const key = toKey(attachment.id);
    const subscribe = useCallback(
        (onStoreChange: () => void) =>
            key === null
                ? () => undefined
                : subscribeAudioDownload(key, onStoreChange),
        [key],
    );
    const getSnapshot = useCallback(
        () => getAudioDownloadSnapshot(attachment),
        [attachment],
    );
    const serverSnapshot = useCallback(() => IDLE_SNAPSHOT, []);
    const snapshot = useSyncExternalStore(
        subscribe,
        getSnapshot,
        serverSnapshot,
    );

    const start = useCallback(() => {
        startAudioDownload(attachment);
    }, [attachment]);

    const retry = useCallback(() => {
        retryAudioDownload(attachment);
    }, [attachment]);

    const cancel = useCallback(() => {
        if (key !== null) cancelAudioDownload(key);
    }, [key]);

    return { ...snapshot, start, cancel, retry };
}

// ── queue ───────────────────────────────────────────────────────────────────

function entryFor(attachment: AudioDownloadAttachment & { id: number }): Entry {
    const existing = entries.get(attachment.id);
    if (existing !== undefined) {
        existing.attachment = attachment;
        return existing;
    }
    const entry: Entry = {
        attachment,
        snapshot: IDLE_SNAPSHOT,
        lastEmitAt: 0,
        controller: null,
        settled: null,
        resolveSettled: null,
        rejectSettled: null,
        cancelRequested: false,
    };
    entries.set(attachment.id, entry);
    return entry;
}

function enqueue(key: number): void {
    if (queue.includes(key)) return;
    const entry = entries.get(key);
    if (entry === undefined) return;
    if (entry.snapshot.state === 'downloading') return;
    queue.push(key);
    pump();
}

function pump(): void {
    while (activeDownloads < MAX_CONCURRENT_AUDIO_DOWNLOADS) {
        const key = queue.shift();
        if (key === undefined) return;
        const entry = entries.get(key);
        if (entry === undefined || entry.cancelRequested) continue;
        activeDownloads += 1;
        void runDownload(entry).finally(() => {
            activeDownloads -= 1;
            pump();
        });
    }
}

function markReady(entry: Entry, uri: string, size: number): void {
    setSnapshot(entry, readySnapshot(uri, size));
    entry.resolveSettled?.(uri);
    entry.settled = null;
}

async function runDownload(entry: Entry): Promise<void> {
    const id = entry.attachment.id;

    const cached = getCacheEntry('audio', id);
    if (cached !== null) {
        touchCacheEntry('audio', id);
        markReady(entry, cached.path, cached.size);
        return;
    }

    entry.controller = new AbortController();
    entry.cancelRequested = false;
    setSnapshot(entry, {
        state: 'downloading',
        progress: 0,
        error: null,
        localUri: null,
    });

    try {
        const file = await downloadMediaFile('audio', entry.attachment, {
            signal: entry.controller.signal,
            onProgress: (progress: number) => {
                if (entry.cancelRequested) return;
                const now = Date.now();
                if (
                    now - entry.lastEmitAt < PROGRESS_THROTTLE_MS &&
                    progress < 1
                ) {
                    return;
                }
                const total = entry.attachment.size ?? 0;
                setSnapshot(entry, {
                    progress,
                    receivedBytes: Math.round(progress * total),
                    totalBytes: total,
                });
            },
        });

        if (entry.cancelRequested) {
            try {
                if (file.exists) file.delete();
            } catch {
                // Best effort; startup cleanup removes leftovers.
            }
            throw new Error('Download cancelled.');
        }

        const expected = entry.attachment.size ?? 0;
        const actual = file.exists ? (file.size ?? 0) : 0;
        if (actual <= 0) {
            throw new Error('The downloaded file is empty.');
        }
        if (expected > 0 && actual !== expected) {
            try {
                if (file.exists) file.delete();
            } catch {
                // Best effort.
            }
            throw new Error('The download was incomplete. Tap to retry.');
        }

        await putCacheEntry('audio', id, file);
        markReady(entry, file.uri, actual);
    } catch (error) {
        const message =
            error instanceof Error && error.message.trim() !== ''
                ? error.message
                : 'Download failed. Tap to retry.';
        entry.rejectSettled?.(new Error(message));
        entry.settled = null;
        if (entry.cancelRequested) {
            entry.snapshot = { ...IDLE_SNAPSHOT };
            emit(entry);
            return;
        }
        setSnapshot(entry, {
            state: 'error',
            error: message,
            localUri: null,
        });
    } finally {
        entry.controller = null;
    }
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Downloads a track (or reuses the cached copy) and resolves with its local
 * `file://` URI. The music player awaits this first, then hands the file to
 * `expo-audio`, so playback starts instantly and works offline.
 */
export function ensureAudioCached(
    attachment: AudioDownloadAttachment,
): Promise<string> {
    const key = toKey(attachment.id);
    if (key === null) {
        return Promise.reject(new Error('This track is still uploading.'));
    }
    const entry = entryFor({ ...attachment, id: key });
    if (entry.snapshot.state === 'ready' && entry.snapshot.localUri !== null) {
        touchCacheEntry('audio', key);
        if (entry.settled !== null) {
            void entry.settled;
        }
        return Promise.resolve(entry.snapshot.localUri);
    }
    if (entry.settled !== null) return entry.settled;

    const cached = getCacheEntry('audio', key);
    if (cached !== null) {
        touchCacheEntry('audio', key);
        markReady(entry, cached.path, cached.size);
        return Promise.resolve(cached.path);
    }

    const promise = new Promise<string>((resolve, reject) => {
        entry.resolveSettled = resolve;
        entry.rejectSettled = reject;
    });
    entry.settled = promise;
    enqueue(key);
    return promise;
}

/** Fire-and-forget download used by the bubble's cover button. */
export function startAudioDownload(attachment: AudioDownloadAttachment): void {
    const key = toKey(attachment.id);
    if (key === null) return;
    const entry = entryFor({ ...attachment, id: key });
    if (entry.snapshot.state === 'ready') return;
    if (entry.snapshot.state === 'error') {
        entry.snapshot = { ...IDLE_SNAPSHOT };
        emit(entry);
    }
    enqueue(key);
}

export function retryAudioDownload(attachment: AudioDownloadAttachment): void {
    const key = toKey(attachment.id);
    if (key === null) return;
    const entry = entryFor({ ...attachment, id: key });
    entry.cancelRequested = false;
    entry.snapshot = { ...IDLE_SNAPSHOT };
    entry.settled = null;
    entry.resolveSettled = null;
    entry.rejectSettled = null;
    emit(entry);
    enqueue(key);
}

export function cancelAudioDownload(id: number): void {
    const entry = entries.get(id);
    if (entry === undefined) return;
    entry.cancelRequested = true;
    entry.controller?.abort();
    const queuedAt = queue.indexOf(id);
    if (queuedAt >= 0) queue.splice(queuedAt, 1);
    if (entry.controller === null) {
        entry.snapshot = { ...IDLE_SNAPSHOT };
        emit(entry);
    }
}

/** Marks the playing track so the size-based LRU never evicts it. */
export function setAudioPlaying(id: number | null, playing: boolean): void {
    if (id === null) return;
    setMediaPlaying('audio', id, playing);
}

/** Removes a downloaded track (message deleted). */
export function evictAudioDownload(id: number): void {
    cancelAudioDownload(id);
    const cached = getCacheEntry('audio', id);
    if (cached !== null) {
        try {
            const file = new File(cached.path);
            if (file.exists) file.delete();
        } catch {
            // Best effort.
        }
    }
    dropCacheEntry('audio', id);
    entries.delete(id);
    notify(id);
}

/** App start: adopt indexed files and clean stale partial downloads. */
export function initAudioDownloader(): Promise<void> {
    if (initialized !== null) return initialized;
    initialized = (async () => {
        await initMediaCache();
        for (const cached of listCacheEntries('audio')) {
            const file = new File(cached.path);
            if (!file.exists) continue;
            const id = toKey(file.name.split('.')[0]);
            if (id === null) continue;
            const entry = entryFor({ id, mimeType: '', name: file.name });
            entry.snapshot = readySnapshot(cached.path, cached.size);
        }
    })();
    return initialized;
}

export function resetAudioDownloaderForTests(): void {
    entries.clear();
    listeners.clear();
    queue.length = 0;
    activeDownloads = 0;
    initialized = null;
}
