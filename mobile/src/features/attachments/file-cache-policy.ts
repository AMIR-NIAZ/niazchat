/** Document cache cap: at most 200 files or 300 MB, oldest first. */
export const MAX_FILE_CACHE_FILES = 200;
export const MAX_FILE_CACHE_BYTES = 300 * 1024 * 1024;

export interface CachedFile {
    path: string;
    size: number;
    modifiedMs: number;
}

/**
 * Paths to delete so the remaining document cache fits both caps. Oldest files
 * go first; the newest file is never evicted unless it alone exceeds the cap.
 */
export function selectFileCacheEvictions(
    files: readonly CachedFile[],
    maxFiles: number = MAX_FILE_CACHE_FILES,
    maxBytes: number = MAX_FILE_CACHE_BYTES,
): string[] {
    let count = files.length;
    let bytes = files.reduce(
        (sum, file) => sum + (Number.isFinite(file.size) ? file.size : 0),
        0,
    );
    const oldestFirst = [...files].sort((a, b) => a.modifiedMs - b.modifiedMs);
    const evicted: string[] = [];
    for (const file of oldestFirst) {
        if (count <= maxFiles && bytes <= maxBytes) {
            break;
        }
        evicted.push(file.path);
        count -= 1;
        bytes -= Number.isFinite(file.size) ? file.size : 0;
    }
    return evicted;
}
