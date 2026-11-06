import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { onSocketReconnect, useSocket } from '../../core/socket';
import type { ChatDto, MessageDto } from '../../core/api';
import { joinChat, fetchChatMessages } from '../chats/chats-socket-api';
import {
    toChatMessage,
    toPendingChatMessage,
    toFailedChatMessage,
    mergeMessages,
    removeMessageById,
    replaceMessage,
    dropPendingKeys,
} from './messages-mapper';
import type { ChatMessage } from './messages-model';
import {
    deliverMessage,
    editChatMessage,
    deleteChatMessage,
} from './messages-socket-api';

/**
 * Conversation server-state over TanStack Query, backed by the documented WS
 * surface (docs/mobile-api/websocket-contract.md):
 *
 * - fetch:  `joinChat { chatId }` (room + chat info ack) → `getMessages`
 *   (history ack — last 50, DESC — reversed to ascending here).
 * - live:   `sendMessage:list` / `editMessage:list` room broadcasts (the sender
 *   receives its own echo — that is the send confirmation) and
 *   `deleteMessage:list` (bare id).
 * - send:   one optimistic pending bubble per in-flight send. Confirmation is
 *   the ack (`data` = the saved message) AND the echo; both go through
 *   `mergeMessages`, which dedupes by id and consumes exactly one pending
 *   bubble, so whichever arrives first confirms and the other is harmless.
 * - reconnect: every socket (re)connect after the first re-joins the room and
 *   merges fresh history into the cache (no UI reset, no duplicate listeners —
 *   `onSocketReconnect` registers one listener per mounted chat, and listeners
 *   follow a replaced socket instance via `useSocket`).
 */

export function messagesQueryKey(chatId: number): readonly [string, number] {
    return ['messages', chatId] as const;
}

export interface ConversationDetail {
    info: ChatDto | null;
    messages: ChatMessage[];
}

export interface ChatMessagesApi {
    detail: ConversationDetail | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
    sending: string | null;
    sendError: string | null;
    send: (content: string) => void;
    retrySend: (key: string) => void;
    edit: (messageId: number, newContent: string) => Promise<void>;
    remove: (messageId: number) => Promise<void>;
    mutating: boolean;
}

export function useChatMessages(
    chatId: number,
    enabled: boolean,
    currentUserId: number | null,
): ChatMessagesApi {
    const queryClient = useQueryClient();
    const socket = useSocket();
    const [saveTimestamp, setSaveTimestamp] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [mutating, setMutating] = useState(false);
    const pendingCounter = useRef(0);

    const query = useQuery<ConversationDetail>({
        queryKey: messagesQueryKey(chatId),
        enabled,
        retry: false,
        queryFn: async (): Promise<ConversationDetail> => {
            // One joinChat ack, then one getMessages ack — no event chaining.
            const info = await joinChat(chatId);
            const messages = (await fetchChatMessages(chatId)) ?? [];
            const history = messages
                .filter((message: MessageDto): boolean => !message.isDeleted)
                .reverse(); // WS delivers DESC; the UI reads ascending (oldest → newest).
            return { info, messages: history.map(toChatMessage) };
        },
    });

    const applyToCache = useCallback(
        (producer: (current: ChatMessage[]) => ChatMessage[]): void => {
            const current = queryClient.getQueryData<ConversationDetail>(
                messagesQueryKey(chatId),
            );
            if (current === undefined) {
                return;
            }
            queryClient.setQueryData<ConversationDetail>(
                messagesQueryKey(chatId),
                {
                    info: current.info,
                    messages: producer(current.messages),
                },
            );
        },
        [chatId, queryClient],
    );

    // Live event listeners — one set per mounted chat, unregistered on unmount.
    // The effect depends on `socket` so a replaced instance gets fresh listeners.
    useEffect((): (() => void) => {
        if (socket === null) {
            return (): void => undefined;
        }
        const myId = currentUserId ?? -1;

        const onNewMessage = (message: MessageDto): void => {
            if (message.chatId !== chatId) {
                return;
            }
            applyToCache((current) =>
                mergeMessages(current, [toChatMessage(message)], myId),
            );
        };
        const onEditedMessage = (message: MessageDto): void => {
            if (message.chatId !== chatId) {
                return;
            }
            applyToCache((current) =>
                replaceMessage(current, toChatMessage(message)),
            );
        };
        const onDeletedMessage = (messageId: number): void => {
            applyToCache((current) => removeMessageById(current, messageId));
        };

        socket.on('sendMessage:list', onNewMessage);
        socket.on('editMessage:list', onEditedMessage);
        socket.on('deleteMessage:list', onDeletedMessage);

        return (): void => {
            socket.off('sendMessage:list', onNewMessage);
            socket.off('editMessage:list', onEditedMessage);
            socket.off('deleteMessage:list', onDeletedMessage);
        };
    }, [socket, chatId, currentUserId, applyToCache]);

    // Reconnect (same instance after an auto-reconnect, or a replacement
    // instance): rooms are server-side and lost with the connection, so re-join
    // and merge history into the cache. `mergeMessages` keeps pending/failed
    // bubbles and dedupes by id, so scroll position and in-flight sends survive.
    const rejoin = useCallback((): void => {
        void (async (): Promise<void> => {
            try {
                await joinChat(chatId);
                const messages = (await fetchChatMessages(chatId)) ?? [];
                const history = messages
                    .filter(
                        (message: MessageDto): boolean => !message.isDeleted,
                    )
                    .reverse()
                    .map(toChatMessage);
                applyToCache((current) =>
                    mergeMessages(current, history, currentUserId ?? -1),
                );
            } catch {
                // Next reconnect (or a manual refetch) resyncs.
            }
        })();
    }, [chatId, currentUserId, applyToCache]);

    useEffect((): (() => void) => onSocketReconnect(rejoin), [rejoin]);

    const send = useCallback(
        (content: string): void => {
            const trimmed = content.trim();
            if (trimmed === '' || saveTimestamp !== null) {
                return;
            }
            pendingCounter.current += 1;
            const localKey = `pending-${String(pendingCounter.current)}`;
            const userId = currentUserId ?? -1;
            applyToCache((current) => [
                ...current,
                toPendingChatMessage(localKey, trimmed, userId),
            ]);
            setSaveTimestamp(localKey);
            setSendError(null);

            deliverMessage(chatId, trimmed)
                .then((sent: MessageDto | null): void => {
                    // Ack confirmation: the saved message (same shape as the
                    // echo) consumes this pending bubble like the echo would.
                    if (sent === null || !Number.isFinite(Number(sent.id))) {
                        return;
                    }
                    applyToCache((current) =>
                        mergeMessages(current, [toChatMessage(sent)], userId),
                    );
                })
                .catch((error: unknown) => {
                    const stillPending =
                        queryClient
                            .getQueryData<ConversationDetail>(
                                messagesQueryKey(chatId),
                            )
                            ?.messages.some(
                                (message) => message.key === localKey,
                            ) ?? false;
                    // Already confirmed by the echo: nothing to fail, no error.
                    if (!stillPending) {
                        return;
                    }
                    applyToCache((current) =>
                        current.map((message) =>
                            message.key === localKey
                                ? toFailedChatMessage(message)
                                : message,
                        ),
                    );
                    setSendError(
                        error instanceof Error
                            ? error.message
                            : 'Failed to send.',
                    );
                })
                .finally(() => {
                    setSaveTimestamp(null);
                });
        },
        [chatId, saveTimestamp, currentUserId, applyToCache, queryClient],
    );

    const retrySend = useCallback(
        (key: string): void => {
            const current = queryClient.getQueryData<ConversationDetail>(
                messagesQueryKey(chatId),
            );
            const failed = current?.messages.find(
                (message) => message.key === key,
            );
            const content = failed?.pendingContent ?? null;
            if (content === null) {
                return;
            }
            applyToCache((next) => dropPendingKeys(next, [key]));
            send(content);
        },
        [chatId, queryClient, applyToCache, send],
    );

    const edit = useCallback(
        async (messageId: number, newContent: string): Promise<void> => {
            setMutating(true);
            try {
                const updated = await editChatMessage(
                    messageId,
                    chatId,
                    newContent,
                );
                // The `editMessage:list` echo normally confirms the edit; the
                // ack carries the same serialized message, so apply it too —
                // whatever arrives first wins, a missed echo never leaves the
                // bubble stale.
                if (updated !== null && Number.isFinite(Number(updated.id))) {
                    applyToCache((current) =>
                        replaceMessage(current, toChatMessage(updated)),
                    );
                }
            } finally {
                setMutating(false);
            }
        },
        [chatId, applyToCache],
    );

    const remove = useCallback(
        async (messageId: number): Promise<void> => {
            setMutating(true);
            // Snapshot for a full restore if the server rejects the delete
            // (the `deleteMessage:list` broadcast removes it for everyone).
            const snapshot =
                queryClient.getQueryData<ConversationDetail>(
                    messagesQueryKey(chatId),
                ) ?? null;
            applyToCache((current) => removeMessageById(current, messageId));
            try {
                await deleteChatMessage(messageId, chatId);
            } catch (error: unknown) {
                if (snapshot !== null) {
                    queryClient.setQueryData<ConversationDetail>(
                        messagesQueryKey(chatId),
                        snapshot,
                    );
                }
                throw error instanceof Error
                    ? error
                    : new Error('Failed to delete message.');
            } finally {
                setMutating(false);
            }
        },
        [chatId, applyToCache, queryClient],
    );

    const detail = query.data ?? null;

    return useMemo(
        () => ({
            detail,
            isLoading: query.isPending,
            error: query.error instanceof Error ? query.error : null,
            refetch: (): void => {
                void query.refetch();
            },
            sending: saveTimestamp,
            sendError,
            send,
            retrySend,
            edit,
            remove,
            mutating,
        }),
        [
            detail,
            query.isPending,
            query.error,
            saveTimestamp,
            sendError,
            send,
            retrySend,
            edit,
            remove,
            mutating,
        ],
    );
}
