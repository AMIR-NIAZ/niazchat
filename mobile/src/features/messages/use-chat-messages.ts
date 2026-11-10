import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { onSocketReconnect, useSocket } from '../../core/socket';
import { registerSessionCleanup } from '../../core/session/cleanup-registry';
import type { ChatDto, MessageDto, ReactionSnapshotDto } from '../../core/api';
import {
    joinChat,
    fetchChatMessages,
    MESSAGES_PAGE_SIZE,
} from '../chats/chats-socket-api';
import {
    toChatMessage,
    toPendingChatMessage,
    mergeMessages,
    removeMessageById,
    replaceMessage,
    dropPendingKeys,
    applyOriginalDeleted,
    applyOriginalEdited,
} from './messages-mapper';
import type {
    AttachmentView,
    ChatMessage,
    ReplyPreview,
} from './messages-model';
import { toNumericId } from './messages-model';
import { applyMyReaction, applyReactionUpdate } from './reaction-helpers';
import {
    mapWithConcurrency,
    uploadAttachment,
} from '../attachments/attachment-upload';
import {
    clearUploadProgress,
    setUploadProgress,
} from '../attachments/upload-progress-store';
import type { LocalAttachment } from '../attachments/validation';
import { MAX_CONCURRENT_UPLOADS } from '../attachments/constants';
import { nextClientMessageId, nextPendingMessageKey } from './local-keys';
import * as FileSystem from 'expo-file-system/legacy';
import {
    deliverMessage,
    editChatMessage,
    deleteChatMessage,
    reactToMessage,
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
    send: (
        content: string,
        options?: {
            replyTo?: ReplyPreview | null;
            attachments?: LocalAttachment[];
        },
    ) => void;
    retrySend: (key: string) => void;
    /** Aborts the uploads of an optimistic bubble and removes it. */
    cancelSend: (key: string) => void;
    edit: (messageId: number, newContent: string) => Promise<void>;
    remove: (messageId: number) => Promise<void>;
    /** One-reaction-per-user toggle with optimistic update and rollback. */
    toggleReaction: (messageId: number, emoji: string) => Promise<void>;
    reactionError: string | null;
    reactingIds: ReadonlySet<number>;
    mutating: boolean;
}

type OlderPageOutcome = 'loaded' | 'noop' | 'error';

interface PendingSendState {
    /** Cache/FlatList key of the optimistic message (`p-<unique>`). */
    key: string;
    content: string;
    replyTo: ReplyPreview | null;
    clientMessageId: string;
    attachments: AttachmentView[];
    /** Local file per attachment key, kept for retry after a failure. */
    sources: Map<string, LocalAttachment>;
    controller: AbortController;
}

/**
 * Pending sends live outside the hook so leaving the screen does not abort an
 * upload or lose a failed, retryable bubble. Re-entering the same chat reuses
 * the same state (and therefore the same keys).
 */
const pendingSendsByChat = new Map<number, Map<string, PendingSendState>>();

/** Removes the local recordings of a sent/cancelled voice message. */
async function deleteVoiceTempFiles(state: PendingSendState): Promise<void> {
    const uris = state.attachments
        .filter((attachment) => attachment.kind === 'voice')
        .map((attachment) => state.sources.get(attachment.key)?.uri)
        .filter(
            (uri): uri is string =>
                typeof uri === 'string' && uri.trim() !== '',
        );
    await Promise.all(
        uris.map((uri) =>
            FileSystem.deleteAsync(uri, { idempotent: true }).catch(
                (): void => undefined,
            ),
        ),
    );
}

/**
 * Logout cleanup: abort every upload/send still running. The bubbles stay in
 * the (now cleared) cache, so nothing leaks into the next session.
 */
function abortAllPendingSends(): void {
    for (const sends of pendingSendsByChat.values()) {
        for (const state of sends.values()) {
            state.controller.abort();
        }
        sends.clear();
    }
}

registerSessionCleanup(abortAllPendingSends);

function pendingSendsFor(chatId: number): Map<string, PendingSendState> {
    let sends = pendingSendsByChat.get(chatId);
    if (sends === undefined) {
        sends = new Map<string, PendingSendState>();
        pendingSendsByChat.set(chatId, sends);
    }
    return sends;
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
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [loadOlderError, setLoadOlderError] = useState<string | null>(null);
    const [reactionError, setReactionError] = useState<string | null>(null);
    const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(
        new Set(),
    );
    const loadingOlderRef = useRef(false);
    const reactionInFlightRef = useRef<Set<number>>(new Set());
    const reactionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const pendingSends = useMemo(() => pendingSendsFor(chatId), [chatId]);
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
        const onReactionUpdated = (event: ReactionSnapshotDto): void => {
            if (
                event === null ||
                typeof event !== 'object' ||
                Number(event.chatId) !== chatId ||
                !Array.isArray(event.reactions)
            ) {
                return;
            }
            applyToCache((current) =>
                applyReactionUpdate(current, event, currentUserId),
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
        socket.on('reaction:updated', onReactionUpdated);
        socket.on('seen', onSeen);
        socket.on('chat:members', onMembersCount);

        return (): void => {
            socket.off('sendMessage:list', onNewMessage);
            socket.off('editMessage:list', onEditedMessage);
            socket.off('deleteMessage:list', onDeletedMessage);
            socket.off('reaction:updated', onReactionUpdated);
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
    // Uploads are deliberately NOT aborted: they keep updating the cached
    // bubble, and a failed send stays retryable when the chat is reopened.
    useEffect((): (() => void) => {
        return (): void => {
            if (reactionErrorTimerRef.current !== null) {
                clearTimeout(reactionErrorTimerRef.current);
                reactionErrorTimerRef.current = null;
            }
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

    const setMessageStatus = useCallback(
        (key: string, status: ChatMessage['status']): void => {
            applyToCache((current) =>
                current.map((message) =>
                    message.key === key ? { ...message, status } : message,
                ),
            );
        },
        [applyToCache],
    );

    const patchAttachment = useCallback(
        (
            state: PendingSendState,
            attachmentKey: string,
            patch: Partial<AttachmentView>,
        ): void => {
            const attachment = state.attachments.find(
                (item) => item.key === attachmentKey,
            );
            if (attachment !== undefined) {
                Object.assign(attachment, patch);
            }
            applyToCache((current) =>
                current.map((message) =>
                    message.key !== state.key
                        ? message
                        : {
                              ...message,
                              attachments: message.attachments.map((item) =>
                                  item.key === attachmentKey
                                      ? { ...item, ...patch }
                                      : item,
                              ),
                          },
                ),
            );
        },
        [applyToCache],
    );

    /**
     * Uploads the missing files (bounded concurrency), then sends the message
     * over the socket with the ids. Per-file failures mark only those files;
     * a socket failure keeps the uploaded ids so Retry only resends.
     */
    const runPendingSend = useCallback(
        async (state: PendingSendState): Promise<void> => {
            const signal = state.controller.signal;
            try {
                const missing = state.attachments.filter(
                    (attachment) => attachment.id === null,
                );

                const uploadOne = async (
                    attachment: AttachmentView,
                ): Promise<void> => {
                    const source = state.sources.get(attachment.key);
                    if (source === undefined) return;
                    patchAttachment(state, attachment.key, {
                        status: 'uploading',
                        error: null,
                    });
                    setUploadProgress(attachment.key, 0);
                    try {
                        const uploaded = await uploadAttachment(
                            chatId,
                            source,
                            {
                                signal,
                                voice: attachment.kind === 'voice',
                                onProgress: (progress): void =>
                                    setUploadProgress(attachment.key, progress),
                            },
                        );
                        patchAttachment(state, attachment.key, {
                            id: uploaded.id,
                            name: uploaded.originalName,
                            mimeType: uploaded.mimeType,
                            size: uploaded.size,
                            kind: uploaded.kind,
                            status: 'uploaded',
                            error: null,
                            ...(uploaded.width !== undefined
                                ? {
                                      width: uploaded.width,
                                      height: uploaded.height,
                                  }
                                : {}),
                            ...(uploaded.duration !== undefined
                                ? { duration: uploaded.duration }
                                : {}),
                            ...(uploaded.hasPoster !== undefined
                                ? { hasPoster: uploaded.hasPoster }
                                : {}),
                            ...(uploaded.waveform !== undefined
                                ? { waveform: uploaded.waveform }
                                : {}),
                        });
                    } catch (error: unknown) {
                        if (signal.aborted) return;
                        patchAttachment(state, attachment.key, {
                            status: 'failed',
                            error:
                                error instanceof Error &&
                                error.message.trim() !== ''
                                    ? error.message
                                    : 'Upload failed',
                        });
                    } finally {
                        clearUploadProgress(attachment.key);
                    }
                };

                // Videos are uploaded strictly one at a time; images/files keep
                // the existing bounded concurrency.
                const videos = missing.filter(
                    (attachment) => attachment.kind === 'video',
                );
                const others = missing.filter(
                    (attachment) => attachment.kind !== 'video',
                );
                for (const video of videos) {
                    if (signal.aborted) return;
                    await uploadOne(video);
                }
                await mapWithConcurrency(
                    others,
                    MAX_CONCURRENT_UPLOADS,
                    uploadOne,
                );
                if (signal.aborted) return;

                if (
                    state.attachments.some(
                        (attachment) => attachment.id === null,
                    )
                ) {
                    setMessageStatus(state.key, 'failed');
                    const failed = state.attachments.find(
                        (attachment) => attachment.status === 'failed',
                    );
                    setSendError(failed?.error ?? 'Unknown upload error');
                    return;
                }

                let sent: MessageDto | null = null;
                try {
                    sent = await deliverMessage(
                        chatId,
                        state.content,
                        state.replyTo?.id,
                        state.attachments
                            .map((attachment) => attachment.id)
                            .filter((id): id is number => id !== null),
                        state.clientMessageId,
                    );
                } catch (error: unknown) {
                    setMessageStatus(state.key, 'failed');
                    setSendError(
                        error instanceof Error
                            ? error.message
                            : 'Failed to send.',
                    );
                    return;
                }

                if (sent !== null && Number.isFinite(Number(sent.id))) {
                    // Ack confirmation; `mergeMessages` consumes the bubble via
                    // its clientMessageId (or falls back to content matching).
                    applyToCache((current) =>
                        mergeMessages(
                            current,
                            [toChatMessage(sent)],
                            currentUserId ?? -1,
                        ),
                    );
                }
                pendingSends.delete(state.key);
                void deleteVoiceTempFiles(state);
            } finally {
                setSaveTimestamp((current) =>
                    current === state.key ? null : current,
                );
            }
        },
        [
            chatId,
            currentUserId,
            applyToCache,
            patchAttachment,
            setMessageStatus,
        ],
    );

    const send = useCallback(
        (
            content: string,
            options: {
                replyTo?: ReplyPreview | null;
                attachments?: LocalAttachment[];
            } = {},
        ): void => {
            const trimmed = content.trim();
            const files = options.attachments ?? [];
            if (
                (trimmed === '' && files.length === 0) ||
                saveTimestamp !== null
            ) {
                return;
            }
            const localKey = nextPendingMessageKey();
            const userId = currentUserId ?? -1;
            const replyTo = options.replyTo ?? null;
            const clientMessageId = nextClientMessageId();
            const attachments: AttachmentView[] = files.map((file) => ({
                key: `u-${file.localKey}`,
                id: null,
                name: file.name,
                mimeType: file.mimeType,
                size: file.size,
                kind: file.kind,
                ...(file.width !== undefined
                    ? { width: file.width, height: file.height }
                    : {}),
                ...(file.duration !== undefined
                    ? { duration: file.duration }
                    : {}),
                ...(file.waveform !== undefined
                    ? { waveform: file.waveform }
                    : {}),
                localUri: file.uri,
                status: 'uploading',
                progress: 0,
                error: null,
            }));
            const state: PendingSendState = {
                key: localKey,
                content: trimmed,
                replyTo,
                clientMessageId,
                attachments,
                sources: new Map(
                    files.map((file, index) => [attachments[index]!.key, file]),
                ),
                controller: new AbortController(),
            };
            pendingSends.set(localKey, state);

            applyToCache((current) => [
                ...current,
                toPendingChatMessage(
                    localKey,
                    trimmed,
                    userId,
                    replyTo,
                    attachments,
                    clientMessageId,
                ),
            ]);
            setSaveTimestamp(localKey);
            setSendError(null);
            void runPendingSend(state);
        },
        [saveTimestamp, currentUserId, applyToCache, runPendingSend],
    );

    const cancelSend = useCallback(
        (key: string): void => {
            const state = pendingSends.get(key);
            state?.controller.abort();
            if (state !== undefined) {
                for (const attachment of state.attachments) {
                    clearUploadProgress(attachment.key);
                }
            }
            pendingSends.delete(key);
            if (state !== undefined) {
                void deleteVoiceTempFiles(state);
            }
            applyToCache((current) => dropPendingKeys(current, [key]));
            setSaveTimestamp((current) => (current === key ? null : current));
            setSendError(null);
        },
        [applyToCache],
    );

    const retrySend = useCallback(
        (key: string): void => {
            const state = pendingSends.get(key);
            if (state !== undefined) {
                if (state.controller.signal.aborted || saveTimestamp === key) {
                    return;
                }
                // Re-upload only the files that have no id yet; uploaded ids
                // are reused and stay valid through the orphan window.
                setMessageStatus(key, 'pending');
                setSendError(null);
                setSaveTimestamp(key);
                void runPendingSend(state);
                return;
            }

            // Legacy text-only failed bubble (no attachment state retained).
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
            const replyTo = failed?.replyTo ?? null;
            applyToCache((next) => dropPendingKeys(next, [key]));
            send(content, { replyTo });
        },
        [
            chatId,
            saveTimestamp,
            queryClient,
            applyToCache,
            runPendingSend,
            setMessageStatus,
            send,
        ],
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

    const toggleReaction = useCallback(
        async (messageId: number, emoji: string): Promise<void> => {
            if (reactionInFlightRef.current.has(messageId)) {
                return;
            }
            const detailNow = queryClient.getQueryData<ConversationDetail>(
                messagesQueryKey(chatId),
            );
            const target = detailNow?.messages.find(
                (message) => message.id === messageId,
            );
            if (
                target === undefined ||
                target.id === null ||
                target.isDeleted ||
                target.status !== 'sent'
            ) {
                return;
            }
            const rollback = {
                reactions: target.reactions.map((reaction) => ({
                    ...reaction,
                })),
                myReaction: target.myReaction,
                myReactionProvided: target.myReactionProvided,
            };

            reactionInFlightRef.current.add(messageId);
            setReactingIds((current) => new Set(current).add(messageId));
            setReactionError(null);
            applyToCache((current) =>
                applyMyReaction(current, messageId, emoji),
            );

            try {
                const snapshot = await reactToMessage(chatId, messageId, emoji);
                if (snapshot !== null) {
                    applyToCache((current) =>
                        applyReactionUpdate(current, snapshot, currentUserId),
                    );
                }
            } catch (error: unknown) {
                applyToCache((current) =>
                    current.map((message) =>
                        message.id === messageId
                            ? { ...message, ...rollback }
                            : message,
                    ),
                );
                setReactionError(
                    error instanceof Error
                        ? error.message
                        : 'Could not update the reaction.',
                );
                if (reactionErrorTimerRef.current !== null) {
                    clearTimeout(reactionErrorTimerRef.current);
                }
                reactionErrorTimerRef.current = setTimeout((): void => {
                    setReactionError(null);
                }, 3000);
            } finally {
                reactionInFlightRef.current.delete(messageId);
                setReactingIds((current) => {
                    const next = new Set(current);
                    next.delete(messageId);
                    return next;
                });
            }
        },
        [chatId, currentUserId, applyToCache, queryClient],
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
            cancelSend,
            edit,
            remove,
            toggleReaction,
            reactionError,
            reactingIds,
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
            cancelSend,
            edit,
            remove,
            toggleReaction,
            reactionError,
            reactingIds,
            mutating,
        ],
    );
}
