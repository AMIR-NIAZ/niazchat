import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Per-user "Recent" list for the global search screen, persisted in
 * AsyncStorage (not SecureStore — it is display state, not a secret). Max 10
 * entries, most recent first; a re-opened chat/user moves to the front instead
 * of duplicating.
 */

const KEY_PREFIX = 'niazchat-search-recent:';
const MAX_ENTRIES = 10;

export type RecentSearchEntry =
    | {
          kind: 'chat';
          /** Chat id this entry re-opens. */
          chatId: number;
          name: string;
          /** Server-relative avatar path, for the instant thumbnail. */
          avatar: string | null;
      }
    | {
          kind: 'user';
          userId: number;
          name: string;
          username: string;
          avatar: string | null;
      };

/** Stable identity used for dedupe, removal and list keys. */
export function recentEntryKey(entry: RecentSearchEntry): string {
    return entry.kind === 'chat'
        ? `chat:${entry.chatId}`
        : `user:${entry.userId}`;
}

function storageKey(userId: number): string {
    return `${KEY_PREFIX}${userId}`;
}

export async function loadRecentSearches(
    userId: number,
): Promise<RecentSearchEntry[]> {
    try {
        const raw = await AsyncStorage.getItem(storageKey(userId));
        if (raw === null) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as RecentSearchEntry[]) : [];
    } catch {
        return [];
    }
}

export async function saveRecentSearch(
    userId: number,
    entry: RecentSearchEntry,
): Promise<void> {
    if (!Number.isFinite(userId) || userId <= 0) {
        return;
    }
    const current = await loadRecentSearches(userId);
    const key = recentEntryKey(entry);
    const next = [entry, ...current.filter((item) => recentEntryKey(item) !== key)]
        .slice(0, MAX_ENTRIES);
    try {
        await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
    } catch {
        // Persisting recents is best-effort: the screen still works without it.
    }
}

export async function removeRecentSearch(
    userId: number,
    entry: RecentSearchEntry,
): Promise<void> {
    const current = await loadRecentSearches(userId);
    const key = recentEntryKey(entry);
    const next = current.filter((item) => recentEntryKey(item) !== key);
    try {
        await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
    } catch {
        // Best-effort, same as save.
    }
}

export async function clearRecentSearches(userId: number): Promise<void> {
    try {
        await AsyncStorage.removeItem(storageKey(userId));
    } catch {
        // Best-effort, same as save.
    }
}
