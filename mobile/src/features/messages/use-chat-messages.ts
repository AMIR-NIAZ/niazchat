import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { onSocketReconnect, useSocket } from '../../core/socket';
import type { ChatDto, MessageDto } from '../../core/api';
import {
    joinChat,
    fetchChatMessages,
    MESSAGES_PAGE_SIZE,
} from '../chats/chats-socket-api';
import {
    toChatMessage,
    toPendingChatMessage,
    toFailedChatMessage,
    mergeMessages,
    removeMessageById,
    replaceMessage,
    dropPendingKeys,
    applyOriginalDeleted,
    applyOriginalEdited,
} from './messages-mapper';
import type { ChatMessage, ReplyPreview } from './messages-model';
import { toNumericId } from './messages-model';
import {
    deliverMessage,
    editChatMessage,
    deleteChatMessage,
} from './messages-socket-api';

/**
 * Conversation server-state over TanStack Query, backed by the documented WS
 * surface (docs/mobile-api/websocket-contract.md):
 *
 * - fetch:  `joinChat { chatId }` (room + chat info ack) → first `getMessages`
 *   page (newest first within the page) reversed to ascending here.
 * - older:  `getMessages { chatId, beforeId: nextCursor, limit: 30 }`, merged
 *   into the existing ascending list (dedupe by id, pending/failed kept last).
 * - live:   `sendMessage:list` / `editMessage:list` room broadcasts (the sender
 *   receives its own echo — that is the send confirmation) and
 *   `deleteMessage:list` (bare id).
 * - send:   one optimistic pending bubble per in-flight send (with its quoted
 *   reply preview). Confirmation is the ack (`data` = the saved message) AND
 *   the echo; both go through `mergeMessages`, which dedupes by id and consumes
 *   exactly one pending bubble, so whichever arrives first confirms.
 * - reply:  the original's edit updates cached quoted previews; deleting the
 *   original switches them to the "deleted" placeholder. `ensureMessageLoaded`
 *   pages backwards (bounded) until a quoted original is loaded.
 * - reconnect: re-join the room and merge ONLY the latest page into the cache
 *   (older loaded pages, scroll position and in-flight sends survive).
 */

export function messagesQueryKey(chatId: number): readonly [string, number] {
    return ['messages', chatId] as const;
}

export interface ConversationDetail {
    info: ChatDto | null;
    messages: ChatMessage[];
    /** More pages exist before the oldest loaded message. */
    hasMore: boolean;
    /** Id of the oldest loaded message, or null when the list is empty. */
    nextCursor: number | null;
    /** Read position when the chat was opened (unread-divider anchor). */
    myLastSeenId: number | null;
    /** Highest read position among the other members (tick state). */
    othersLastSeenId: number | null;
}

export type EnsureMessageOutcome =
    | 'found'
    | 'not_found'
    | 'error'
    | 'cancelled';

/** Structural cancellation signal (an `AbortSignal` satisfies it). */
export interface LoadSignal {
    readonly aborted: boolean;
}

export interface EnsureMessageOptions {
    /** Hard cap of older pages to fetch (default 10 = 300 messages). */
    maxPages?: number;
    signal?: LoadSignal;
}

export interface ChatMessagesApi {
    detail: ConversationDetail | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
    loadingOlder: boolean;
    loadOlderError: string | null;
    loadOlder: () => void;
    /** Pages backwards until `messageId` is in the cache (bounded/cancellable). */
    ensureMessageLoaded: (
        messageId: number,
        options?: EnsureMessageOptions,
    ) => Promise<EnsureMessageOutcome>;
    sending: string | null;
    sendError: string | null;
    send: (content: string, replyTo?: ReplyPreview | null) => void;
    retrySend: (key: string) => void;
    edit: (messageId: number, newContent: string) => Promise<void>;
    remove: (messageId: number) => Promise<void>;
    mutating: boolean;
}

type OlderPageOutcome = 'loaded' | 'noop' | 'error';

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
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [loadOlderError, setLoadOlderError] = useState<string | null>(null);
    const pendingCounter = useRef(0);
    const loadingOlderRef = useRef(false);
    const olderRequestId = useRef(0);
    const olderPagePromise = useRef<Promise<OlderPageOutcome> | null>(null);

    const query = useQuery<ConversationDetail>({
        queryKey: messagesQueryKey(chatId),
        enabled,
        retry: false,
        queryFn: async (): Promise<ConversationDetail> => {
            // One joinChat ack (+ first page), no event chaining.
            const joined = await joinChat(chatId);
            if (joined === null || joined.info === null) {
                return {
                    info: joined?.info ?? null,
                    messages: [],
                    hasMore: false,
                    nextCursor: null,
                    myLastSeenId: null,
                    othersLastSeenId: null,
                };
            }
            const history = joined.messages
                .filter((message: MessageDto): boolean => !message.isDeleted)
                .reverse() // WS delivers each page DESC; the cache is ascending.
                .map(toChatMessage);
            return {
                info: joined.info,
                messages: history,
                hasMore: joined.hasMore,
                nextCursor: joined.nextCursor,
                myLastSeenId: toNumericId(joined.info.myLastSeenId),
                othersLastSeenId: toNumericId(joined.info.othersLastSeenId),
            };
        },
    });

    // Message-list updates preserve every other field (hasMore, nextCursor,
    // info), so live events can never drop pagination state.
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
                    ...current,
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
            const edited = toChatMessage(message);
            applyToCache((current) =>
                applyOriginalEdited(replaceMessage(current, edited), edited),
            );
        };
        const onDeletedMessage = (messageId: number): void => {
            // The message leaves the cache; replies quoting it switch to the
            // content-less "Message deleted" preview without a refetch.
            applyToCache((current) =>
                applyOriginalDeleted(
                    removeMessageById(current, messageId),
                    messageId,
                ),
            );
        };
        const onSeen = (payload: {
            chatId: number;
            userId: number;
            lastSeenId: number | null;
        }): void => {
            if (Number(payload.chatId) !== chatId) {
                return;
            }
            // Own echoes come from this device or another one; only other
            // members advance the tick line.
            if (Number(payload.userId) === myId) {
                return;
            }
            const seenId = toNumericId(payload.lastSeenId);
            if (seenId === null) {
                return;
            }
            queryClient.setQueryData<ConversationDetail>(
                messagesQueryKey(chatId),
                (current) =>
                    current === undefined
                        ? current
                        : {
                              ...current,
                              othersLastSeenId: Math.max(
                                  current.othersLastSeenId ?? 0,
                                  seenId,
                              ),
                          },
            );
        };

        const onMembersCount = (payload: {
            chatId: number;
            membersCount: number;
        }): void => {
            if (Number(payload.chatId) !== chatId) {
                return;
            }
            const membersCount = Number(payload.membersCount);
            if (!Number.isFinite(membersCount)) {
                return;
            }
            queryClient.setQueryData<ConversationDetail>(
                messagesQueryKey(chatId),
                (current) =>
                    current === undefined || current.info === null
                        ? current
                        : {
                              ...current,
                              info: { ...current.info, membersCount },
                          },
            );
        };

        socket.on('sendMessage:list', onNewMessage);
        socket.on('editMessage:list', onEditedMessage);
        socket.on('deleteMessage:list', onDeletedMessage);
        socket.on('seen', onSeen);
        socket.on('chat:members', onMembersCount);

        return (): void => {
            socket.off('sendMessage:list', onNewMessage);
            socket.off('editMessage:list', onEditedMessage);
            socket.off('deleteMessage:list', onDeletedMessage);
            socket.off('seen', onSeen);
            socket.off('chat:members', onMembersCount);
        };
    }, [socket, chatId, currentUserId, applyToCache, queryClient]);

    // Reconnect (same instance after an auto-reconnect, or a replacement
    // instance): rooms are server-side and lost with the connection, so re-join
    // and merge the latest page into the cache. `mergeMessages` keeps pending/
    // failed bubbles and older pages, and dedupes by id; `applyToCache` keeps
    // hasMore/nextCursor untouched.
    const rejoin = useCallback((): void => {
        void (async (): Promise<void> => {
            try {
                const joined = await joinChat(chatId);
                if (joined === null) {
                    return;
                }
                const history = joined.messages
                    .filter(
                        (message: MessageDto): boolean => !message.isDeleted,
                    )
                    .reverse()
                    .map(toChatMessage);
                applyToCache((current) =>
                    mergeMessages(current, history, currentUserId ?? -1),
                );
                // Reconnect resync of the room-wide read line; never regress it.
                const others = toNumericId(joined.info?.othersLastSeenId);
                if (others !== null) {
                    queryClient.setQueryData<ConversationDetail>(
                        messagesQueryKey(chatId),
                        (current) =>
                            current === undefined
                                ? current
                                : {
                                      ...current,
                                      othersLastSeenId: Math.max(
                                          current.othersLastSeenId ?? 0,
                                          others,
                                      ),
                                  },
                    );
                }
            } catch {
                // Next reconnect (or a manual refetch) resyncs.
            }
        })();
    }, [chatId, currentUserId, applyToCache, queryClient]);

    useEffect((): (() => void) => onSocketReconnect(rejoin), [rejoin]);

    // Invalidates an in-flight `loadOlder` when the screen unmounts or the chat
    // changes while the request is still running (stale-response guard).
    useEffect((): (() => void) => {
        return (): void => {
            olderRequestId.current += 1;
            loadingOlderRef.current = false;
            olderPagePromise.current = null;
        };
    }, [chatId]);

    /**
     * One older page. Concurrent callers share the in-flight request (never a
     * second `getMessages` while one runs). Resolves with the outcome instead
     * of throwing, so `ensureMessageLoaded` can loop.
     */
    const loadOlderPage = useCallback((): Promise<OlderPageOutcome> => {
        const inFlight = olderPagePromise.current;
        if (inFlight !== null) {
            return inFlight;
        }
        if (query.isPending) {
            return Promise.resolve('noop');
        }
        const current = queryClient.getQueryData<ConversationDetail>(
            messagesQueryKey(chatId),
        );
        if (
            current === undefined ||
            !current.hasMore ||
            current.nextCursor === null
        ) {
            return Promise.resolve('noop');
        }
        const beforeId = current.nextCursor;
        olderRequestId.current += 1;
        const requestId = olderRequestId.current;
        loadingOlderRef.current = true;
        setLoadingOlder(true);
        setLoadOlderError(null);

        const promise = fetchChatMessages(chatId, beforeId, MESSAGES_PAGE_SIZE)
            .then((page): OlderPageOutcome => {
                if (requestId !== olderRequestId.current) {
                    return 'noop';
                }
                if (page === null) {
                    return 'error';
                }
                const older = page.messages
                    .filter(
                        (message: MessageDto): boolean => !message.isDeleted,
                    )
                    .reverse() // page is DESC; merge expects ascending input.
                    .map(toChatMessage);
                queryClient.setQueryData<ConversationDetail>(
                    messagesQueryKey(chatId),
                    (previous) =>
                        previous === undefined
                            ? previous
                            : {
                                  ...previous,
                                  messages: mergeMessages(
                                      previous.messages,
                                      older,
                                      currentUserId ?? -1,
                                  ),
                                  hasMore: page.hasMore,
                                  nextCursor: page.nextCursor,
                              },
                );
                return 'loaded';
            })
            .catch((error: unknown): OlderPageOutcome => {
                if (requestId !== olderRequestId.current) {
                    return 'noop';
                }
                setLoadOlderError(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load older messages.',
                );
                return 'error';
            })
            .finally((): void => {
                if (requestId !== olderRequestId.current) {
                    return;
                }
                loadingOlderRef.current = false;
                setLoadingOlder(false);
            });

        olderPagePromise.current = promise;
        void promise.finally((): void => {
            if (olderPagePromise.current === promise) {
                olderPagePromise.current = null;
            }
        });
        return promise;
    }, [chatId, currentUserId, queryClient, query.isPending]);

    const loadOlder = useCallback((): void => {
        void loadOlderPage();
    }, [loadOlderPage]);

    /**
     * Pages backwards until `messageId` is in the cache, history ends, the page
     * cap is reached, loading fails or the caller cancels. Never scrolls.
     */
    const ensureMessageLoaded = useCallback(
        async (
            messageId: number,
            options: EnsureMessageOptions = {},
        ): Promise<EnsureMessageOutcome> => {
            const maxPages = options.maxPages ?? 10;
            const signal = options.signal;
            const isLoaded = (): boolean =>
                queryClient
                    .getQueryData<ConversationDetail>(messagesQueryKey(chatId))
                    ?.messages.some((message) => message.id === messageId) ??
                false;

            if (isLoaded()) {
                return 'found';
            }

            for (let pages = 0; pages < maxPages; pages += 1) {
                if (signal?.aborted) {
                    return 'cancelled';
                }
                const before = queryClient.getQueryData<ConversationDetail>(
                    messagesQueryKey(chatId),
                );
                if (before === undefined) {
                    return 'cancelled';
                }
                if (!before.hasMore || before.nextCursor === null) {
                    return 'not_found';
                }
                const loadedCount = before.messages.length;
                const outcome = await loadOlderPage();
                if (signal?.aborted) {
                    return 'cancelled';
                }
                if (outcome === 'error') {
                    return 'error';
                }
                if (isLoaded()) {
                    return 'found';
                }
                const after = queryClient.getQueryData<ConversationDetail>(
                    messagesQueryKey(chatId),
                );
                if (after === undefined) {
                    return 'cancelled';
                }
                // No progress (already loading ended, stale chat, empty page).
                if (
                    outcome === 'noop' ||
                    after.messages.length === loadedCount
                ) {
                    return 'not_found';
                }
                if (!after.hasMore || after.nextCursor === null) {
                    return 'not_found';
                }
            }
            return 'not_found';
        },
        [chatId, queryClient, loadOlderPage],
    );

    const send = useCallback(
        (content: string, replyTo: ReplyPreview | null = null): void => {
            const trimmed = content.trim();
            if (trimmed === '' || saveTimestamp !== null) {
                return;
            }
            pendingCounter.current += 1;
            const localKey = `pending-${String(pendingCounter.current)}`;
            const userId = currentUserId ?? -1;
            applyToCache((current) => [
                ...current,
                toPendingChatMessage(localKey, trimmed, userId, replyTo),
            ]);
            setSaveTimestamp(localKey);
            setSendError(null);

            deliverMessage(chatId, trimmed, replyTo?.id)
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
            // Keep the reply target on retry (the send failed, not the quote).
            const replyTo = failed?.replyTo ?? null;
            applyToCache((next) => dropPendingKeys(next, [key]));
            send(content, replyTo);
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
                // bubble stale. Editing never changes `replyTo`.
                if (updated !== null && Number.isFinite(Number(updated.id))) {
                    const edited = toChatMessage(updated);
                    applyToCache((current) =>
                        applyOriginalEdited(
                            replaceMessage(current, edited),
                            edited,
                        ),
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
            applyToCache((current) =>
                applyOriginalDeleted(
                    removeMessageById(current, messageId),
                    messageId,
                ),
            );
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
            loadingOlder,
            loadOlderError,
            loadOlder,
            ensureMessageLoaded,
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
            loadingOlder,
            loadOlderError,
            loadOlder,
            ensureMessageLoaded,
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
