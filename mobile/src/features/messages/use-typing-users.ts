import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket, useSocketEvent } from '../../core/socket';
import type { MessageDto } from '../../core/api';

/**
 * Ephemeral typing state for the open GROUP chat (never TanStack cache).
 *
 * `typing:start` entries expire 5 s after the last start (one interval for the
 * whole map), so a lost stop/disconnect cannot leave a stuck indicator. Own
 * events (including this account's other devices) are ignored, and a live
 * message from a user clears that user immediately.
 */

const TYPING_TTL_MS = 5000;
const MAX_TYPING_USERS = 5;
const EXPIRY_SWEEP_MS = 1000;

export interface TypingUser {
    userId: number;
    name: string;
}

interface TypingEntry {
    name: string;
    expiresAt: number;
}

function readEvent(
    payload: unknown,
): { chatId: number; userId: number; name: string } | null {
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }
    const data = payload as {
        chatId?: unknown;
        userId?: unknown;
        userName?: unknown;
    };
    const chatId = Number(data.chatId);
    const userId = Number(data.userId);
    if (!Number.isFinite(chatId) || !Number.isFinite(userId)) {
        return null;
    }
    return {
        chatId,
        userId,
        name: typeof data.userName === 'string' ? data.userName : '',
    };
}

export function useTypingUsers(
    chatId: number,
    enabled: boolean,
    currentUserId: number | null,
): TypingUser[] {
    const socket = useSocket();
    const [entries, setEntries] = useState<Map<number, TypingEntry>>(
        () => new Map(),
    );

    // A different chat or socket instance starts with no typing state.
    useEffect((): void => {
        setEntries(new Map());
    }, [chatId, socket]);

    const myId = currentUserId ?? -1;

    const removeUser = useCallback((userId: number): void => {
        setEntries((previous) => {
            if (!previous.has(userId)) {
                return previous;
            }
            const next = new Map(previous);
            next.delete(userId);
            return next;
        });
    }, []);

    const onStart = useCallback(
        (payload: unknown): void => {
            if (!enabled) return;
            const event = readEvent(payload);
            if (event === null || event.chatId !== chatId) {
                return;
            }
            if (event.userId === myId) {
                return;
            }
            setEntries((previous) => {
                if (
                    !previous.has(event.userId) &&
                    previous.size >= MAX_TYPING_USERS
                ) {
                    return previous;
                }
                const next = new Map(previous);
                next.set(event.userId, {
                    name: event.name,
                    expiresAt: Date.now() + TYPING_TTL_MS,
                });
                return next;
            });
        },
        [enabled, chatId, myId],
    );

    const onStop = useCallback(
        (payload: unknown): void => {
            if (!enabled) return;
            const event = readEvent(payload);
            if (event === null || event.chatId !== chatId) {
                return;
            }
            removeUser(event.userId);
        },
        [enabled, chatId, removeUser],
    );

    const onMessage = useCallback(
        (message: MessageDto): void => {
            if (!enabled) return;
            if (Number(message.chatId) !== chatId) {
                return;
            }
            const senderId = Number(message.senderId);
            if (Number.isFinite(senderId)) {
                removeUser(senderId);
            }
        },
        [enabled, chatId, removeUser],
    );

    // A reconnect loses room membership and any in-flight indicators.
    const clearAll = useCallback((): void => setEntries(new Map()), []);

    useSocketEvent('typing:start', onStart);
    useSocketEvent('typing:stop', onStop);
    useSocketEvent('sendMessage:list', onMessage);
    useSocketEvent('disconnect', clearAll);
    useSocketEvent('connect', clearAll);

    // Single sweeper for every entry (not one timer per user).
    useEffect((): (() => void) | undefined => {
        if (!enabled) {
            return undefined;
        }
        const sweeper = setInterval((): void => {
            const now = Date.now();
            setEntries((previous) => {
                let changed = false;
                const next = new Map(previous);
                for (const [userId, entry] of next) {
                    if (entry.expiresAt <= now) {
                        next.delete(userId);
                        changed = true;
                    }
                }
                return changed ? next : previous;
            });
        }, EXPIRY_SWEEP_MS);
        return (): void => clearInterval(sweeper);
    }, [enabled]);

    return useMemo(
        () =>
            [...entries.entries()].map(([userId, entry]) => ({
                userId,
                name: entry.name,
            })),
        [entries],
    );
}
