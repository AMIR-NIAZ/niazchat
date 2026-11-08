import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onSocketReconnect } from '../../core/socket';
import { markChatSeen } from './messages-socket-api';
import { toNumericId } from './messages-model';
import { setChatUnreadCount } from '../chats/use-chats';

const MARK_SEEN_DEBOUNCE_MS = 300;

/**
 * Sends `markSeen` with the newest confirmed message id once the user is
 * actually looking at the bottom of the conversation.
 *
 * `canMark` is the caller's "focused + app active + near bottom" gate.
 * Re-evaluation is driven by changes to that gate, the newest id, a reconnect,
 * and by an in-flight request finishing. Failures are logged in dev and do not
 * retry the same id; a newer message (or a reconnect) re-arms the hook.
 */
export function useMarkSeen(
    chatId: number | null,
    newestConfirmedId: number | null,
    canMark: boolean,
): void {
    const queryClient = useQueryClient();
    const ackedRef = useRef(0);
    const attemptedRef = useRef(0);
    const inFlightRef = useRef(false);
    const [tick, setTick] = useState(0);

    // A different chat starts from zero; reconnect re-arms the send as well.
    useEffect(() => {
        ackedRef.current = 0;
        attemptedRef.current = 0;
        inFlightRef.current = false;
    }, [chatId]);

    useEffect(
        () =>
            onSocketReconnect(() => {
                attemptedRef.current = 0;
                setTick((value) => value + 1);
            }),
        [],
    );

    useEffect(() => {
        if (
            chatId === null ||
            newestConfirmedId === null ||
            !canMark ||
            inFlightRef.current
        ) {
            return;
        }
        // Monotonic: never send a value at or below what was acknowledged (or
        // already attempted and rejected) for this chat.
        if (
            newestConfirmedId <=
            Math.max(ackedRef.current, attemptedRef.current)
        ) {
            return;
        }

        const target = newestConfirmedId;
        const timer = setTimeout(() => {
            inFlightRef.current = true;
            attemptedRef.current = target;
            markChatSeen(chatId, target)
                .then((data) => {
                    const acked = toNumericId(data?.lastSeenId) ?? target;
                    ackedRef.current = Math.max(ackedRef.current, acked);
                    setChatUnreadCount(queryClient, chatId, 0);
                })
                .catch((error: unknown) => {
                    if (__DEV__) {
                        console.log('[markSeen] failed', error);
                    }
                })
                .finally(() => {
                    inFlightRef.current = false;
                    setTick((value) => value + 1);
                });
        }, MARK_SEEN_DEBOUNCE_MS);

        return (): void => {
            clearTimeout(timer);
        };
    }, [chatId, newestConfirmedId, canMark, tick, queryClient]);
}
