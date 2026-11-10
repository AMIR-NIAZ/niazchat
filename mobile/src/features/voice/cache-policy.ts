/** Voice cache cap: at most 100 files or 100 MB, oldest first. */
export const MAX_VOICE_CACHE_FILES = 100;
export const MAX_VOICE_CACHE_BYTES = 100 * 1024 * 1024;

export interface CachedVoiceFile {
    path: string;
    size: number;
    modifiedMs: number;
}

/**
 * Returns the paths to delete so the remaining cache fits both caps. Oldest
 * files go first; the newest file is never evicted (unless it alone is over
 * the byte cap).
 */
export function selectVoiceEvictions(
    files: readonly CachedVoiceFile[],
    maxFiles: number = MAX_VOICE_CACHE_FILES,
    maxBytes: number = MAX_VOICE_CACHE_BYTES,
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
