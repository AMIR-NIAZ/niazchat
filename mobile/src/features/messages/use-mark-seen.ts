import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onSocketReconnect } from '../../core/socket';
import { ApiError } from '../../core/api';
import { markChatSeen } from './messages-socket-api';
import { toNumericId } from './messages-model';
import { ReadReceiptRunner } from './read-receipt';
import { setChatUnreadCount } from '../chats/use-chats';

const MARK_SEEN_DEBOUNCE_MS = 300;

/**
 * Sends `markSeen` for the highest message the user is actually looking at.
 *
 * `canMark` is the caller's "focused + app active + initial positioning done"
 * gate. The caller chooses the target: the newest confirmed id while at the
 * bottom, or the highest visible id while reading older history. Re-evaluation
 * is driven by that target, the gate, a reconnect, a bounded retry of a
 * transient failure, and by an in-flight request finishing.
 *
 * The state machine lives in `ReadReceiptRunner`: monotonic per chat, one
 * request in flight, no duplicate sends, transient failures retried (bounded),
 * and an unacknowledged receipt re-armed when the chat regains focus or the
 * socket reconnects. Sending a message or reacting is never required for a
 * receipt to be delivered.
 */
export function useMarkSeen(
    chatId: number | null,
    readTargetId: number | null,
    canMark: boolean,
): void {
    const queryClient = useQueryClient();
    const runnerRef = useRef<ReadReceiptRunner | null>(null);
    if (runnerRef.current === null) {
        runnerRef.current = new ReadReceiptRunner();
    }
    const [tick, setTick] = useState(0);

    // A different chat starts from zero; reconnect re-arms the send as well.
    useEffect((): void => {
        runnerRef.current?.reset(chatId);
        setTick((value) => value + 1);
    }, [chatId]);

    // Any focus/foreground transition re-arms a position that was never
    // acknowledged. A receipt must not disappear because the app was
    // backgrounded (or the ack timed out) while it was in flight.
    useEffect((): void => {
        runnerRef.current?.release();
    }, [canMark]);

    useEffect(
        (): (() => void) =>
            onSocketReconnect((): void => {
                runnerRef.current?.reconnect();
                setTick((value) => value + 1);
            }),
        [],
    );

    useEffect((): (() => void) | undefined => {
        const runner = runnerRef.current;
        if (runner === null || chatId === null) {
            return undefined;
        }
        const plan = runner.plan({
            chatId,
            targetId: readTargetId,
            canMark,
            now: Date.now(),
        });
        if (plan.action === 'idle') {
            return undefined;
        }
        if (plan.action === 'wait') {
            const retryTimer = setTimeout((): void => {
                setTick((value) => value + 1);
            }, plan.delayMs);
            return (): void => clearTimeout(retryTimer);
        }

        const target = plan.target;
        const targetChatId = chatId;
        const timer = setTimeout((): void => {
            runner.begin(target);
            markChatSeen(targetChatId, target)
                .then((data) => {
                    const acknowledged =
                        toNumericId(data?.lastSeenId) ?? target;
                    runner.ack(acknowledged);
                    setChatUnreadCount(queryClient, targetChatId, 0);
                })
                .catch((error: unknown) => {
                    // Only transport-level failures are worth retrying; a
                    // server rejection is deterministic for this position.
                    const transient =
                        error instanceof ApiError && error.statusCode === 0;
                    runner.fail(transient, Date.now());
                    if (__DEV__) {
                        console.log('[markSeen] failed', error);
                    }
                })
                .finally((): void => {
                    runner.finish();
                    setTick((value) => value + 1);
                });
        }, MARK_SEEN_DEBOUNCE_MS);

        return (): void => {
            clearTimeout(timer);
        };
    }, [chatId, readTargetId, canMark, tick, queryClient]);
}
