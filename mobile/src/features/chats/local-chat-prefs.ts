import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

/**
 * Device-local chat preferences.
 *
 * The backend stores NO per-user pin/mute/delete state (the `chats` and
 * `chat_members` tables only hold group data), so pinning is local:
 * - scoped per authenticated user id;
 * - persisted through `expo-secure-store` (the app's only storage dependency)
 *   as a compact JSON array of numeric chat ids;
 * - NOT synced across devices, and lost when the app is uninstalled.
 *
 * SecureStore expects small values (Android keeps them under a few KB), which
 * is ample for a chat pin list but not for arbitrary data.
 */

const PINNED_KEY_PREFIX = 'niazchat.pinnedChats.v1:';

function pinnedKey(userId: number): string {
    return `${PINNED_KEY_PREFIX}${userId}`;
}

function parseIds(raw: string | null): Set<number> {
    if (raw === null) {
        return new Set();
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return new Set();
        }
        return new Set(
            parsed.filter(
                (value): value is number =>
                    typeof value === 'number' &&
                    Number.isInteger(value) &&
                    value > 0,
            ),
        );
    } catch {
        return new Set();
    }
}

export async function loadPinnedChatIds(userId: number): Promise<Set<number>> {
    try {
        return parseIds(await SecureStore.getItemAsync(pinnedKey(userId)));
    } catch {
        // Storage unavailable (e.g. web): pins stay in memory for this session.
        return new Set();
    }
}

export async function savePinnedChatIds(
    userId: number,
    ids: ReadonlySet<number>,
): Promise<void> {
    try {
        if (ids.size === 0) {
            await SecureStore.deleteItemAsync(pinnedKey(userId));
            return;
        }
        await SecureStore.setItemAsync(
            pinnedKey(userId),
            JSON.stringify([...ids]),
        );
    } catch {
        // Keep the in-memory state; persistence is best-effort.
    }
}

export interface PinnedChatsState {
    pinned: ReadonlySet<number>;
    togglePin: (chatId: number) => void;
}

/** Loads the current user's pins and keeps local changes in sync. */
export function usePinnedChatIds(userId: number | null): PinnedChatsState {
    const [pinned, setPinned] = useState<ReadonlySet<number>>(
        (): ReadonlySet<number> => new Set(),
    );

    useEffect((): (() => void) => {
        let cancelled = false;
        if (userId === null) {
            return (): void => {
                cancelled = true;
            };
        }
        void loadPinnedChatIds(userId).then((ids) => {
            if (!cancelled) {
                setPinned(ids);
            }
        });
        return (): void => {
            cancelled = true;
        };
    }, [userId]);

    const togglePin = useCallback(
        (chatId: number): void => {
            if (userId === null) {
                return;
            }
            setPinned((current) => {
                const next = new Set(current);
                if (next.has(chatId)) {
                    next.delete(chatId);
                } else {
                    next.add(chatId);
                }
                void savePinnedChatIds(userId, next);
                return next;
            });
        },
        [userId],
    );

    return { pinned, togglePin };
}
