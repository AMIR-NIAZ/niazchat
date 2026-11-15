import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Persister } from '@tanstack/react-query-persist-client';

/**
 * Persisted TanStack Query cache (account/lists only).
 *
 * One AsyncStorage key per user (`niazchat-query-cache:<userId>`) so a second
 * account can never read the first one's data, and an identity is required
 * before anything is read or written: while `currentUserId` is null the storage
 * client is a no-op.
 *
 * What may be persisted is decided by `isPersistableQueryKey` — an allowlist,
 * never a blocklist. Messages live in SQLite, tokens in SecureStore; mutations,
 * pending/errored queries and everything ephemeral (bans, permissions, invite
 * links, upload/download state) stay memory-only.
 */

export const PERSIST_BUSTER = 'niazchat-query-cache-v1';
export const QUERY_CACHE_KEY_PREFIX = 'niazchat-query-cache:';
/** Seven days — restored data older than this is discarded. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Coalesce cache writes; never a write per render/event. */
const PERSIST_THROTTLE_MS = 1000;

let currentUserId: number | null = null;

export function setCurrentCacheUserId(userId: number | null): void {
    currentUserId = userId;
}

export function getCurrentCacheUserId(): number | null {
    return currentUserId;
}

/**
 * Query-key allowlist (exact families):
 * - `['me']` — own profile
 * - `['chats']` — the chat list only, not `['chats','members'|…]`
 * - `['chat-info', chatId]`
 * - `['group', chatId]` and `['group', chatId, 'members', search]`
 * - `['user', userId]` — public profiles
 * - `['contacts', 'saved']` and `['contacts', 'matches']` — the two Contact
 *   tab sources (the matches map is the only persisted address-book result)
 */
export function isPersistableQueryKey(key: readonly unknown[]): boolean {
    const first = key[0];
    if (first === 'me' || first === 'chats') {
        return key.length === 1;
    }
    if (first === 'chat-info' || first === 'user') {
        return key.length === 2 && typeof key[1] === 'number';
    }
    if (first === 'group') {
        if (key.length === 2) {
            return true;
        }
        return key.length === 4 && key[2] === 'members';
    }
    if (first === 'contacts') {
        return key.length === 2 && (key[1] === 'saved' || key[1] === 'matches');
    }
    return false;
}

/**
 * Only allowlisted queries that still HOLD data are dehydrated — whatever the
 * status. A failed background refetch (offline) must not erase the last good
 * copy from disk; that would turn one offline launch into a permanently empty
 * list on the next launch.
 */
export function shouldPersistQuery(query: {
    queryKey: readonly unknown[];
    state: { data: unknown };
}): boolean {
    return (
        query.state.data !== undefined && isPersistableQueryKey(query.queryKey)
    );
}

function storageKeyFor(userId: number): string {
    return `${QUERY_CACHE_KEY_PREFIX}${userId}`;
}

/**
 * AsyncStorage-backed persister that routes every call through the CURRENT
 * user id. A storage failure (corrupt/unavailable) is swallowed: the key is
 * removed best-effort and the app continues from the network.
 */
const userScopedStorage = {
    async getItem(): Promise<string | null> {
        const userId = currentUserId;
        if (userId === null) {
            return null;
        }
        const storageKey = storageKeyFor(userId);
        try {
            return await AsyncStorage.getItem(storageKey);
        } catch {
            try {
                await AsyncStorage.removeItem(storageKey);
            } catch {
                // Storage is unusable; ignore.
            }
            return null;
        }
    },
    async setItem(_key: string, value: string): Promise<void> {
        const userId = currentUserId;
        if (userId === null) {
            return;
        }
        try {
            await AsyncStorage.setItem(storageKeyFor(userId), value);
        } catch {
            // A failed persist must never surface to the UI.
        }
    },
    async removeItem(): Promise<void> {
        const userId = currentUserId;
        if (userId === null) {
            return;
        }
        try {
            await AsyncStorage.removeItem(storageKeyFor(userId));
        } catch {
            // Ignore.
        }
    },
};

export const persistedQueryClientPersister: Persister =
    createAsyncStoragePersister({
        storage: userScopedStorage,
        throttleTime: PERSIST_THROTTLE_MS,
    });

/** Removes one explicit user's persisted cache (identity-safe after logout). */
export async function removePersistedCacheForUserId(
    userId: number,
): Promise<void> {
    try {
        await AsyncStorage.removeItem(storageKeyFor(userId));
    } catch {
        // Logout must always finish.
    }
}

export async function removePersistedCacheForCurrentUser(): Promise<void> {
    const userId = currentUserId;
    if (userId === null) {
        return;
    }
    await removePersistedCacheForUserId(userId);
}
