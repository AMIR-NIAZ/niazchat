import AsyncStorage from '@react-native-async-storage/async-storage';
import { MUSIC_PLAY_ORDERS, type MusicPlayOrder } from './music-queue';

/**
 * Persisted play order of the global music player, one AsyncStorage key per
 * user (display state, not a secret — same approach as the recent searches).
 * Default is `forward`; changing it applies to the next track immediately.
 */

const KEY_PREFIX = 'niazchat-music-order:';

function storageKey(userId: number): string {
    return `${KEY_PREFIX}${userId}`;
}

export function isMusicPlayOrder(value: unknown): value is MusicPlayOrder {
    return (
        typeof value === 'string' &&
        (MUSIC_PLAY_ORDERS as readonly string[]).includes(value)
    );
}

export async function loadMusicPlayOrder(
    userId: number,
): Promise<MusicPlayOrder | null> {
    try {
        const raw = await AsyncStorage.getItem(storageKey(userId));
        return isMusicPlayOrder(raw) ? raw : null;
    } catch {
        return null;
    }
}

export async function saveMusicPlayOrder(
    userId: number,
    order: MusicPlayOrder,
): Promise<void> {
    if (!Number.isFinite(userId) || userId <= 0) return;
    try {
        await AsyncStorage.setItem(storageKey(userId), order);
    } catch {
        // Best-effort: the player still works with the in-memory choice.
    }
}
