import { Directory, File, Paths } from 'expo-file-system';

/**
 * Persistent media cache shared by images and videos.
 *
 * Layout (under the app's documents directory, NOT the OS-purgeable cache):
 *   media-cache/
 *     index.json            attachmentId -> { path, size, lastAccessedAt }
 *     images/<id>.<ext>
 *     videos/<id>.<ext>
 *
 * Files are downloaded to `<final>.part` and only renamed once the download
 * completed without error, so a partial file is never treated as cached.
 * One LRU rule: the total size may not exceed MAX_MEDIA_CACHE_BYTES.
 */

export const MAX_MEDIA_CACHE_BYTES = 500 * 1024 * 1024;

/** A `.part` younger than this may be an interrupted download worth resuming. */
export const ORPHAN_PART_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const ROOT_DIRECTORY = 'media-cache';
const INDEX_FILE = 'index.json';

export type MediaCacheKind = 'image' | 'video' | 'audio';

export interface MediaCacheEntry {
    /** Absolute `file://` URI of the cached file. */
    path: string;
    size: number;
    lastAccessedAt: number;
}

interface IndexShape {
    version: 1;
    entries: Record<string, MediaCacheEntry>;
}

let entries: Record<string, MediaCacheEntry> | null = null;
let initialized = false;
let writeChain: Promise<void> = Promise.resolve();
/** Keys that must never be evicted (the video currently playing). */
const playing = new Set<string>();

export function mediaCacheKey(
    kind: MediaCacheKind,
    id: number | string,
): string {
    // Normalise so a numeric string and a number are the same entry.
    const numeric = typeof id === 'number' ? id : Number(id);
    return `${kind}:${Number.isFinite(numeric) ? numeric : id}`;
}

export function rootDirectory(): Directory {
    return new Directory(Paths.document, ROOT_DIRECTORY);
}

export function mediaDirectory(kind: MediaCacheKind): Directory {
    const name =
        kind === 'image' ? 'images' : kind === 'video' ? 'videos' : 'audio';
    return new Directory(rootDirectory(), name);
}

export function ensureMediaDirectory(kind: MediaCacheKind): Directory {
    const directory = mediaDirectory(kind);
    if (!directory.exists) {
        directory.create({ intermediates: true, idempotent: true });
    }
    return directory;
}

function isEntry(value: unknown): value is MediaCacheEntry {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Partial<MediaCacheEntry>;
    return (
        typeof entry.path === 'string' &&
        entry.path !== '' &&
        typeof entry.size === 'number' &&
        Number.isFinite(entry.size) &&
        typeof entry.lastAccessedAt === 'number' &&
        Number.isFinite(entry.lastAccessedAt)
    );
}

function readEntries(): Record<string, MediaCacheEntry> {
    if (entries !== null) return entries;
    entries = {};
    try {
        const file = new File(rootDirectory(), INDEX_FILE);
        if (!file.exists) return entries;
        const parsed = JSON.parse(file.textSync()) as Partial<IndexShape>;
        if (typeof parsed.entries !== 'object' || parsed.entries === null) {
            return entries;
        }
        for (const [key, value] of Object.entries(parsed.entries)) {
            if (isEntry(value)) {
                entries[key] = value;
            }
        }
    } catch {
        entries = {};
    }
    return entries;
}

function writeIndex(): void {
    try {
        const directory = rootDirectory();
        if (!directory.exists) {
            directory.create({ intermediates: true, idempotent: true });
        }
        const index: IndexShape = { version: 1, entries: readEntries() };
        new File(directory, INDEX_FILE).writeSync(JSON.stringify(index));
    } catch {
        // The index is best effort: cached files remain usable without it.
    }
}

/** Serialize index writes so concurrent downloads cannot interleave. */
function persist(): Promise<void> {
    writeChain = writeChain.then(writeIndex).catch((): void => undefined);
    return writeChain;
}

function removeQuietly(file: File): void {
    try {
        if (file.exists) file.delete();
    } catch {
        // Already gone or not deletable; eviction continues.
    }
}

/** Total size in bytes of every file tracked by the cache index. */
export function getCacheSize(): Promise<number> {
    const map = readEntries();
    return Promise.resolve(
        Object.values(map).reduce(
            (sum, entry) =>
                sum + (Number.isFinite(entry.size) ? entry.size : 0),
            0,
        ),
    );
}

/**
 * Returns the cached entry for `kind` + `id` if the file still exists and is
 * non-empty. Missing files are dropped from the index.
 */
export function getCacheEntry(
    kind: MediaCacheKind,
    id: number,
): MediaCacheEntry | null {
    const key = mediaCacheKey(kind, id);
    const map = readEntries();
    const entry = map[key];
    if (entry === undefined) return null;
    const file = new File(entry.path);
    let size = 0;
    try {
        size = file.exists ? (file.size ?? 0) : 0;
    } catch {
        size = 0;
    }
    if (size <= 0) {
        delete map[key];
        void persist();
        return null;
    }
    if (entry.size !== size) {
        entry.size = size;
        void persist();
    }
    return entry;
}

/** Drops an index entry (the file itself is left to the caller). */
export function dropCacheEntry(kind: MediaCacheKind, id: number): void {
    const map = readEntries();
    const key = mediaCacheKey(kind, id);
    if (map[key] === undefined) return;
    delete map[key];
    void persist();
}

/** Snapshot of the indexed entries of one kind (read-only copies). */
export function listCacheEntries(kind: MediaCacheKind): MediaCacheEntry[] {
    const prefix = `${kind}:`;
    return Object.entries(readEntries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([, entry]) => ({ ...entry }));
}

/** Marks an entry as just used for the LRU order. */
export function touchCacheEntry(kind: MediaCacheKind, id: number): void {
    const entry = readEntries()[mediaCacheKey(kind, id)];
    if (entry === undefined) return;
    entry.lastAccessedAt = Date.now();
    void persist();
}

/**
 * Registers a fully downloaded file and enforces the size cap. `protectedKey`
 * (the entry just added) is never evicted by this call.
 */
export async function putCacheEntry(
    kind: MediaCacheKind,
    id: number,
    file: File,
): Promise<MediaCacheEntry | null> {
    let size = 0;
    try {
        size = file.exists ? (file.size ?? 0) : 0;
    } catch {
        size = 0;
    }
    if (size <= 0) return null;
    const key = mediaCacheKey(kind, id);
    const entry: MediaCacheEntry = {
        path: file.uri,
        size,
        lastAccessedAt: Date.now(),
    };
    readEntries()[key] = entry;
    await persist();
    await evictIfNeeded(key);
    return entry;
}

/** Protects the video that is currently playing from LRU eviction. */
export function setMediaPlaying(
    kind: MediaCacheKind,
    id: number,
    value: boolean,
): void {
    const key = mediaCacheKey(kind, id);
    if (value) {
        playing.add(key);
    } else {
        playing.delete(key);
    }
}

/** Deletes the least recently used files until the total fits the cap. */
export async function evictIfNeeded(protectedKey?: string): Promise<void> {
    const map = readEntries();
    let total = Object.values(map).reduce(
        (sum, entry) => sum + (Number.isFinite(entry.size) ? entry.size : 0),
        0,
    );
    if (total <= MAX_MEDIA_CACHE_BYTES) return;

    const candidates = Object.entries(map)
        .filter(([key]) => key !== protectedKey && !playing.has(key))
        .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    for (const [key, entry] of candidates) {
        if (total <= MAX_MEDIA_CACHE_BYTES) break;
        delete map[key];
        total -= Number.isFinite(entry.size) ? entry.size : 0;
        removeQuietly(new File(entry.path));
    }
    await persist();
}

/** Deletes every cached file and the index. */
export async function clearCache(): Promise<void> {
    await writeChain.catch((): void => undefined);
    entries = {};
    playing.clear();
    try {
        const directory = rootDirectory();
        if (directory.exists) directory.delete();
    } catch {
        // Best effort.
    }
    await persist();
}

/**
 * App-start housekeeping: load the index, delete leftover `.part` files from
 * interrupted downloads and drop entries whose file disappeared.
 */
export async function initMediaCache(): Promise<void> {
    readEntries();
    if (initialized) return;
    initialized = true;
    try {
        for (const kind of ['image', 'video', 'audio'] as const) {
            const directory = mediaDirectory(kind);
            if (!directory.exists) continue;
            for (const item of directory.list()) {
                if (!(item instanceof File)) continue;
                if (!item.name.includes('.part')) continue;
                // Only a stale partial is deleted: a recent one may still be a
                // resumable download from the previous session.
                let modified = 0;
                try {
                    modified = item.lastModified ?? 0;
                } catch {
                    modified = 0;
                }
                if (modified < Date.now() - ORPHAN_PART_MAX_AGE_MS) {
                    removeQuietly(item);
                }
            }
        }
        const map = readEntries();
        let changed = false;
        for (const [key, entry] of Object.entries(map)) {
            let size = 0;
            try {
                const file = new File(entry.path);
                size = file.exists ? (file.size ?? 0) : 0;
            } catch {
                size = 0;
            }
            // A missing or resized file is not a verified download any more.
            if (size <= 0 || size !== entry.size) {
                if (size > 0) {
                    removeQuietly(new File(entry.path));
                }
                delete map[key];
                changed = true;
            }
        }

        // Adopt complete files from a download that finished right before the
        // app was killed (the file was renamed, but the index write was lost).
        for (const kind of ['image', 'video', 'audio'] as const) {
            const directory = mediaDirectory(kind);
            if (!directory.exists) continue;
            for (const item of directory.list()) {
                if (!(item instanceof File)) continue;
                if (item.name.endsWith('.part')) continue;
                const match = /^(\d+)\./.exec(item.name);
                if (match === null) continue;
                const id = Number(match[1]);
                const key = mediaCacheKey(kind, id);
                if (!Number.isFinite(id) || map[key] !== undefined) continue;
                const size = item.size ?? 0;
                if (size <= 0) continue;
                map[key] = {
                    path: item.uri,
                    size,
                    lastAccessedAt: item.lastModified ?? Date.now(),
                };
                changed = true;
            }
        }

        if (changed) await persist();
        await evictIfNeeded();
    } catch {
        // Listing can fail if the directory vanished between the checks.
    }
}
