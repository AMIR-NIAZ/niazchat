import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    getSocket,
    onSocketReconnect,
    useSocketEvent,
} from '../../core/socket';
import { registerSessionCleanup } from '../../core/session/cleanup-registry';
import { ApiError } from '../../core/api';
import type { ChatDto, MessageDto, ReactionSnapshotDto } from '../../core/api';
import {
    joinChat,
    fetchChatMessages,
    MESSAGES_PAGE_SIZE,
} from '../chats/chats-socket-api';
import {
    clearChatRoom,
    getActiveRoomChatId,
    getFocusedChatId,
    markChatBlurred,
    markChatFocused,
    needsChatRoomJoin,
} from '../chats/active-room';
import {
    toChatMessage,
    toPendingChatMessage,
    mergeMessages,
    reconcileMessages,
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
import { notifyMediaViewerMessageDeleted } from '../attachments/media-viewer-store';
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
import {
    loadLatestLocalMessages,
    loadOlderLocalMessages,
} from '../../shared/local-db';
import type { ChatInfo, ChatPreview } from '../chats/chats-model';
import * as FileSystem from 'expo-file-system/legacy';
import {
    deliverMessage,
    editChatMessage,
    deleteChatMessage,
    reactToMessage,
    pinChatMessage,
    unpinChatMessage,
    fetchPinnedMessages,
} from './messages-socket-api';
import {
    applyPinnedState,
    removePinnedMessage,
    replacePinnedMessage,
    upsertPinnedMessage,
} from './pinned-messages';

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
    /**
     * Where `nextCursor` comes from: local SQLite rows, or the server.
     * Undefined is treated as `'server'` (a plain network conversation).
     */
    nextCursorSource?: 'local' | 'server';
    /**
     * Confirmed `system` ids that arrived LIVE while this chat was open (not
     * history/pagination). Drives the pill entrance animation; never cached.
     */
    liveMessageIds?: number[];
    /**
     * Every pinned message of the chat, newest pin first. Kept separately from
     * `messages` because a pinned message can be older than the loaded page;
     * synchronized on open/reconnect (`getPinnedMessages`) and live events.
     */
    pinnedMessages: ChatMessage[];
}

/**
 * Pagination reached the end of locally saved history while offline. Not an
 * error: the chat shows this line instead of a retry row.
 */
export const NO_MORE_SAVED_MESSAGES = 'No more saved messages';

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
    /**
     * The first fetch attempt has settled (success or failure). A locally
     * seeded conversation becomes safe to position on only at this point: until
     * then the join ack can still supply the read position its rows lack.
     */
    isFetched: boolean;
    error: Error | null;
    refetch: () => void;
    loadingOlder: boolean;
    loadOlderError: string | null;
    loadOlder: () => void;
    /**
     * Re-join the chat room when this screen regains focus after the socket's
     * active chat moved elsewhere (another chat pushed over it, profile, a
     * reconnect while blurred). Merges one fresh page so nothing that arrived
     * while the room was lost is skipped. No-op on the first focus (the query's
     * initial `joinChat` owns that join).
     */
    ensureActive: () => void;
    /** Leave the room when this screen loses focus (that chat is no longer shown). */
    releaseActive: () => void;
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
    /** Pin/unpin through the WS API; rejects with the server message. */
    pin: (messageId: number) => Promise<void>;
    unpin: (messageId: number) => Promise<void>;
    /** Ids with an in-flight pin request (duplicate taps are ignored). */
    pinningIds: ReadonlySet<number>;
    reactionError: string | null;
    reactingIds: ReadonlySet<number>;
    mutating: boolean;
    /**
     * The server answered 403/404 for this chat on a re-join: it was deleted
     * for both (or the caller lost access). The screen must leave it.
     */
    gone: boolean;
}

/** `joinChat` answered "not a member" / "no such chat" (deleted for both). */
function isChatGoneError(error: unknown): boolean {
    return (
        error instanceof ApiError &&
        (error.statusCode === 403 || error.statusCode === 404)
    );
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
 * If the ack succeeded but the optimistic bubble is somehow still unconfirmed
 * after this long (a lost update, a cache reset), one fresh latest page is
 * merged in. Rare and cheap; the pending/echo logic itself is untouched.
 */
export const SEND_CONFIRM_SAFETY_MS = 8000;

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

/**
 * Chat info for a locally seeded conversation: the persisted `chat-info`
 * entry, otherwise the persisted chat-list row. Without one the chat still
 * opens (messages render); the header just cannot name the conversation until
 * the server answers.
 */
function buildCachedChatInfo(
    queryClient: ReturnType<typeof useQueryClient>,
    chatId: number,
): ChatDto | null {
    const detailed = queryClient.getQueryData<ChatInfo>(['chat-info', chatId]);
    if (detailed !== undefined) {
        return {
            id: detailed.id,
            createdAt: detailed.createdAt,
            updatedAt: detailed.updatedAt,
            title: detailed.title,
            peer: detailed.peer,
            avatars: detailed.avatarUrls,
            type: detailed.type,
            isBan: detailed.isBan,
            myLastSeenId: detailed.myLastSeenId,
            othersLastSeenId: detailed.othersLastSeenId,
            membersCount: detailed.membersCount,
        };
    }
    const list = queryClient.getQueryData<ChatPreview[]>(['chats']);
    const row = list?.find((chat) => Number(chat.id) === chatId);
    if (row === undefined) {
        return null;
    }
    return {
        id: row.id,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        title: row.title,
        peer: row.peer,
        avatars: row.avatarUrls,
        type: row.type,
        isBan: row.isBan,
    };
}

export function useChatMessages(
    chatId: number,
    enabled: boolean,
    currentUserId: number | null,
): ChatMessagesApi {
    const queryClient = useQueryClient();
    const [saveTimestamp, setSaveTimestamp] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [mutating, setMutating] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [loadOlderError, setLoadOlderError] = useState<string | null>(null);
    const [reactionError, setReactionError] = useState<string | null>(null);
    const [gone, setGone] = useState(false);
    const [reactingIds, setReactingIds] = useState<ReadonlySet<number>>(
        new Set(),
    );
    const loadingOlderRef = useRef(false);
    const reactionInFlightRef = useRef<Set<number>>(new Set());
    const pinInFlightRef = useRef<Set<number>>(new Set());
    const [pinningIds, setPinningIds] = useState<ReadonlySet<number>>(
        new Set(),
    );
    const reactionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const pendingSends = useMemo(() => pendingSendsFor(chatId), [chatId]);
    const olderRequestId = useRef(0);
    const olderPagePromise = useRef<Promise<OlderPageOutcome> | null>(null);
    /** True while the conversation query itself is performing the joining. */
    const initialJoinPendingRef = useRef(false);
    /** True while a focus/reconnect room sync is in flight (never stack them). */
    const syncingRoomRef = useRef(false);
    /** The first focus of a mounted screen is joined by the query, not by us. */
    const firstFocusHandledRef = useRef(false);
    /** Set on blur: the next focus must re-sync even if the marker still matches. */
    const roomSyncNeededRef = useRef(false);

    const query = useQuery<ConversationDetail>({
        queryKey: messagesQueryKey(chatId),
        enabled,
        retry: false,
        queryFn: async (): Promise<ConversationDetail> => {
            // One joinChat ack (+ first page), no event chaining.
            initialJoinPendingRef.current = true;
            const joined = await joinChat(chatId).finally((): void => {
                initialJoinPendingRef.current = false;
            });
            // Offline/cold start: the full pinned list is a separate ack so a
            // pin older than the first history page still reaches the banner.
            const pinnedDtos = await fetchPinnedMessages(chatId).catch(
                (): null => null,
            );
            const pinnedMessages = (pinnedDtos ?? [])
                .filter((message: MessageDto): boolean => !message.isDeleted)
                .map(toChatMessage);
            if (joined === null || joined.info === null) {
                // Keep a locally seeded conversation instead of wiping it.
                const seeded = queryClient.getQueryData<ConversationDetail>(
                    messagesQueryKey(chatId),
                );
                if (seeded !== undefined) {
                    // Offline: the local mirror already knows which cached rows
                    // are pinned; a failed pinned fetch must not erase them.
                    return pinnedDtos === null
                        ? seeded
                        : { ...seeded, pinnedMessages };
                }
                return {
                    info: null,
                    messages: [],
                    hasMore: false,
                    nextCursor: null,
                    myLastSeenId: null,
                    othersLastSeenId: null,
                    pinnedMessages,
                };
            }
            const history = joined.messages
                .filter((message: MessageDto): boolean => !message.isDeleted)
                .reverse() // WS delivers each page DESC; the cache is ascending.
                .map(toChatMessage);
            // The server page is authoritative inside its id range; anything
            // seeded from SQLite that the server no longer has is dropped.
            const cached = queryClient.getQueryData<ConversationDetail>(
                messagesQueryKey(chatId),
            );
            return {
                info: joined.info,
                messages: reconcileMessages(
                    cached?.messages ?? [],
                    history,
                    currentUserId ?? -1,
                ),
                hasMore: joined.hasMore,
                nextCursor: joined.nextCursor,
                nextCursorSource: 'server',
                myLastSeenId: toNumericId(joined.info.myLastSeenId),
                othersLastSeenId: toNumericId(joined.info.othersLastSeenId),
                pinnedMessages,
            };
        },
    });

    // Seed from SQLite before the first server page resolves: a chat opened
    // before renders its saved messages instead of a loader (and stays usable
    // offline). The server page later merges via `reconcileMessages`.
    const seededChatRef = useRef<number | null>(null);
    useEffect((): (() => void) | undefined => {
        if (
            !enabled ||
            currentUserId === null ||
            seededChatRef.current === chatId
        ) {
            return undefined;
        }
        const userId = currentUserId;
        seededChatRef.current = chatId;
        const key = messagesQueryKey(chatId);
        let cancelled = false;
        void (async (): Promise<void> => {
            // The server (or another screen) already produced data: never
            // overwrite it with older local rows.
            if (queryClient.getQueryState(key)?.data !== undefined) {
                return;
            }
            const local = await loadLatestLocalMessages(userId, chatId, 50);
            if (cancelled || local.length === 0) {
                return;
            }
            if (queryClient.getQueryState(key)?.data !== undefined) {
                return;
            }
            const oldest = local[0]?.id ?? null;
            const info = buildCachedChatInfo(queryClient, chatId);
            queryClient.setQueryData<ConversationDetail>(key, {
                info,
                messages: local,
                hasMore: true,
                nextCursor: oldest,
                nextCursorSource: oldest === null ? 'server' : 'local',
                // The mirrored rows carry no read state of their own. Reuse the
                // persisted chat-info position when it exists, so an offline
                // open can still place the unread divider correctly instead of
                // treating the whole saved page as unread.
                myLastSeenId: toNumericId(info?.myLastSeenId),
                othersLastSeenId: toNumericId(info?.othersLastSeenId),
                pinnedMessages: local.filter((message) => message.isPinned),
            });
        })();
        return (): void => {
            cancelled = true;
        };
    }, [chatId, enabled, currentUserId, queryClient]);

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
            const messages = producer(current.messages);
            // A merge that changed nothing must not republish the conversation:
            // the same array keeps the list data, its memoized rows and the
            // scroll position untouched (re-merges are common on open/rejoin).
            if (messages === current.messages) {
                return;
            }
            queryClient.setQueryData<ConversationDetail>(
                messagesQueryKey(chatId),
                {
                    ...current,
                    messages,
                },
            );
        },
        [chatId, queryClient],
    );

    // Live event listeners: one subscription per event, rebound only when the
    // socket INSTANCE changes (useSocketEvent reads the handler from a ref, so
    // an inline handler never re-subscribes and never duplicates).
    const myId = currentUserId ?? -1;

    const onNewMessage = (message: MessageDto): void => {
        if (message.chatId !== chatId) {
            return;
        }
        const incoming = toChatMessage(message);
        // Mark the live service message BEFORE the list changes, so its first
        // render already sees `animate` (batched or not). Only live arrivals
        // animate; history/pagination loads never do.
        if (incoming.type === 'system' && incoming.id !== null) {
            const id = incoming.id;
            queryClient.setQueryData<ConversationDetail>(
                messagesQueryKey(chatId),
                (current) =>
                    current === undefined
                        ? current
                        : {
                              ...current,
                              liveMessageIds: [
                                  ...(current.liveMessageIds ?? []).filter(
                                      (value) => value !== id,
                                  ),
                                  id,
                              ],
                          },
            );
        }
        applyToCache((current) => mergeMessages(current, [incoming], myId));
    };
    const onEditedMessage = (message: MessageDto): void => {
        if (message.chatId !== chatId) {
            return;
        }
        const edited = toChatMessage(message);
        applyToCache((current) =>
            applyOriginalEdited(replaceMessage(current, edited), edited),
        );
        // The banner preview follows an edit of the pinned message.
        queryClient.setQueryData<ConversationDetail>(
            messagesQueryKey(chatId),
            (current) =>
                current === undefined
                    ? current
                    : {
                          ...current,
                          pinnedMessages: replacePinnedMessage(
                              current.pinnedMessages ?? [],
                              edited,
                          ),
                      },
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
        // Deleting a pinned message also unpins it server-side; the banner
        // must never keep a tombstoned message (even if the unpin broadcast
        // races or is missed).
        queryClient.setQueryData<ConversationDetail>(
            messagesQueryKey(chatId),
            (current) =>
                current === undefined
                    ? current
                    : {
                          ...current,
                          pinnedMessages: removePinnedMessage(
                              current.pinnedMessages ?? [],
                              messageId,
                          ),
                      },
        );
        // A full-screen media viewer may be showing this message's media.
        notifyMediaViewerMessageDeleted(Number(messageId));
    };
    const onPinnedMessage = (payload: {
        chatId: number;
        message: MessageDto;
    }): void => {
        if (
            payload === null ||
            typeof payload !== 'object' ||
            Number(payload.chatId) !== chatId ||
            payload.message === undefined ||
            payload.message === null
        ) {
            return;
        }
        const pinned = toChatMessage(payload.message);
        if (pinned.id === null) {
            return;
        }
        applyToCache((current) =>
            applyPinnedState(
                current,
                pinned.id as number,
                true,
                pinned.pinnedAtIso,
            ),
        );
        queryClient.setQueryData<ConversationDetail>(
            messagesQueryKey(chatId),
            (current) =>
                current === undefined
                    ? current
                    : {
                          ...current,
                          pinnedMessages: upsertPinnedMessage(
                              current.pinnedMessages ?? [],
                              pinned,
                          ),
                      },
        );
    };
    const onUnpinnedMessage = (payload: {
        chatId: number;
        messageId: number;
    }): void => {
        if (
            payload === null ||
            typeof payload !== 'object' ||
            Number(payload.chatId) !== chatId
        ) {
            return;
        }
        const messageId = toNumericId(payload.messageId);
        if (messageId === null) {
            return;
        }
        applyToCache((current) =>
            applyPinnedState(current, messageId, false, null),
        );
        queryClient.setQueryData<ConversationDetail>(
            messagesQueryKey(chatId),
            (current) =>
                current === undefined
                    ? current
                    : {
                          ...current,
                          pinnedMessages: removePinnedMessage(
                              current.pinnedMessages ?? [],
                              messageId,
                          ),
                      },
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

    useSocketEvent('sendMessage:list', onNewMessage);
    useSocketEvent('editMessage:list', onEditedMessage);
    useSocketEvent('deleteMessage:list', onDeletedMessage);
    useSocketEvent('pinMessage:list', onPinnedMessage);
    useSocketEvent('unpinMessage:list', onUnpinnedMessage);
    useSocketEvent('reaction:updated', onReactionUpdated);
    useSocketEvent('seen', onSeen);
    useSocketEvent('chat:members', onMembersCount);

    // (Re)join the chat room and merge the latest page into the cache. Used by
    // the reconnect path and by a focus re-join after the socket's active chat
    // moved elsewhere. `mergeMessages` keeps pending/failed bubbles and older
    // pages, and dedupes by id; `applyToCache` keeps hasMore/nextCursor
    // untouched. Re-joining is idempotent server-side.
    const rejoin = useCallback(async (): Promise<void> => {
        try {
            const joined = await joinChat(chatId);
            if (joined === null) {
                return;
            }
            const history = joined.messages
                .filter((message: MessageDto): boolean => !message.isDeleted)
                .reverse()
                .map(toChatMessage);
            applyToCache((current) =>
                reconcileMessages(current, history, currentUserId ?? -1),
            );
            // Reconnect/refocus: resync the pinned list so pins that happened
            // while this socket was offline are restored without a refresh.
            const pinnedDtos =
                (await fetchPinnedMessages(chatId).catch((): null => null)) ??
                null;
            if (pinnedDtos !== null) {
                const pinnedMessages = pinnedDtos
                    .filter(
                        (message: MessageDto): boolean => !message.isDeleted,
                    )
                    .map(toChatMessage);
                queryClient.setQueryData<ConversationDetail>(
                    messagesQueryKey(chatId),
                    (current) =>
                        current === undefined
                            ? current
                            : { ...current, pinnedMessages },
                );
            }
            // Resync of the room-wide read line; never regress it.
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
        } catch (error: unknown) {
            // "Delete for both" (or losing membership) while this screen was
            // open: drop the cached history so stale messages cannot remain on
            // display, and let the screen navigate away.
            if (isChatGoneError(error)) {
                setGone(true);
                queryClient.removeQueries({
                    queryKey: messagesQueryKey(chatId),
                });
            }
            // Otherwise the next reconnect/focus (or a manual refetch) resyncs.
        }
    }, [chatId, currentUserId, applyToCache, queryClient]);

    /**
     * Called by the chat screen on every focus. The first focus is a no-op (the
     * conversation query's `joinChat` is the initial join). Later focuses
     * happen after the screen was blurred, which released the room, or after
     * the socket's active chat moved to another screen that was pushed on top
     * — both must re-join before live events are trusted again.
     */
    const ensureActive = useCallback((): void => {
        markChatFocused(chatId);
        const firstFocus = !firstFocusHandledRef.current;
        firstFocusHandledRef.current = true;
        const syncRequired = roomSyncNeededRef.current;
        roomSyncNeededRef.current = false;
        if (
            !needsChatRoomJoin({
                chatId,
                activeRoomChatId: getActiveRoomChatId(),
                initialJoinPending: initialJoinPendingRef.current,
                loading: query.isPending,
                syncing: syncingRoomRef.current,
                syncRequired,
            })
        ) {
            return;
        }
        if (firstFocus) {
            // The conversation query has not claimed the room yet; it will.
            return;
        }
        syncingRoomRef.current = true;
        void rejoin().finally((): void => {
            syncingRoomRef.current = false;
        });
    }, [chatId, query.isPending, rejoin]);

    /**
     * Called when the chat screen loses focus: that chat is no longer on
     * screen, so this screen stops owning the single active room. Only the
     * screen that currently owns it may leave it (a stale blur of an
     * underlying chat must not remove the chat on top).
     */
    const releaseActive = useCallback((): void => {
        roomSyncNeededRef.current = true;
        markChatBlurred(chatId);
        if (!clearChatRoom(chatId)) {
            return;
        }
        const live = getSocket();
        if (live !== null && live.connected) {
            live.emit('leaveChat', { chatId }, () => {});
        }
    }, [chatId]);

    // Reconnect: rooms are server-side and lost with the connection. Only the
    // chat that currently has focus may claim the (single) active room again;
    // a blurred screen re-joins when it is focused next.
    useEffect(
        (): (() => void) =>
            onSocketReconnect((): void => {
                if (getFocusedChatId() === chatId) {
                    void rejoin();
                }
            }),
        [chatId, rejoin],
    );

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
            initialJoinPendingRef.current = false;
            syncingRoomRef.current = false;
            firstFocusHandledRef.current = false;
            roomSyncNeededRef.current = false;
            setGone(false);
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

        const promise = (async (): Promise<OlderPageOutcome> => {
            const source = current.nextCursorSource ?? 'server';
            let localExhausted = false;

            // Local-first: a chat seeded from SQLite pages through saved rows
            // before touching the network. Empty/partial local history falls
            // through to the server at the SAME cursor boundary.
            if (source === 'local' && currentUserId !== null) {
                const local = await loadOlderLocalMessages(
                    currentUserId,
                    chatId,
                    beforeId,
                    MESSAGES_PAGE_SIZE,
                );
                if (requestId !== olderRequestId.current) {
                    return 'noop';
                }
                if (local.length > 0 && beforeId !== null) {
                    const full = local.length >= MESSAGES_PAGE_SIZE;
                    const oldest = local[0]?.id ?? beforeId;
                    queryClient.setQueryData<ConversationDetail>(
                        messagesQueryKey(chatId),
                        (previous) =>
                            previous === undefined
                                ? previous
                                : {
                                      ...previous,
                                      messages: mergeMessages(
                                          previous.messages,
                                          local,
                                          currentUserId ?? -1,
                                      ),
                                      nextCursor: full ? oldest : beforeId,
                                      nextCursorSource: full
                                          ? 'local'
                                          : 'server',
                                  },
                    );
                    return 'loaded';
                }
                localExhausted = true;
            }

            // The messages API is socket-backed: with no live socket there is
            // nothing to ask, and waiting for the request timeout would look
            // like a stuck loader while offline.
            const liveSocket = getSocket();
            if (liveSocket === null || !liveSocket.connected) {
                setLoadOlderError(
                    localExhausted
                        ? NO_MORE_SAVED_MESSAGES
                        : 'You are offline.',
                );
                return 'error';
            }

            try {
                const page = await fetchChatMessages(
                    chatId,
                    beforeId,
                    MESSAGES_PAGE_SIZE,
                );
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
                                  nextCursorSource: 'server',
                              },
                );
                return 'loaded';
            } catch (error: unknown) {
                if (requestId !== olderRequestId.current) {
                    return 'noop';
                }
                // Out of locally saved rows and the network is unreachable:
                // that is the end of local history, not a failure to retry.
                setLoadOlderError(
                    localExhausted
                        ? NO_MORE_SAVED_MESSAGES
                        : error instanceof Error
                          ? error.message
                          : 'Failed to load older messages.',
                );
                return 'error';
            }
        })().finally((): void => {
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

    /** Merge one fresh latest page without joining the room or touching
     * pagination state (older pages, pending/failed bubbles are preserved). */
    const mergeLatestPage = useCallback(async (): Promise<void> => {
        try {
            const page = await fetchChatMessages(chatId);
            if (page === null) return;
            const history = page.messages
                .filter((message: MessageDto): boolean => !message.isDeleted)
                .reverse()
                .map(toChatMessage);
            applyToCache((current) =>
                reconcileMessages(current, history, currentUserId ?? -1),
            );
        } catch {
            // The next focus/reconnect (or a manual retry) resyncs.
        }
    }, [chatId, currentUserId, applyToCache]);

    /**
     * Safety net for a confirmed send whose bubble somehow never left the
     * pending state: merge the latest page once, eight seconds later.
     */
    const scheduleSendConfirmation = useCallback(
        (state: PendingSendState): void => {
            setTimeout((): void => {
                const current = queryClient.getQueryData<ConversationDetail>(
                    messagesQueryKey(chatId),
                );
                const stillPending =
                    current?.messages.some(
                        (message) =>
                            message.clientMessageId === state.clientMessageId &&
                            message.status !== 'sent',
                    ) ?? false;
                if (stillPending) void mergeLatestPage();
            }, SEND_CONFIRM_SAFETY_MS);
        },
        [chatId, queryClient, mergeLatestPage],
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
                    scheduleSendConfirmation(state);
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
            scheduleSendConfirmation,
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

    /**
     * Pin/unpin one message. The in-flight set makes duplicate taps a no-op
     * (the backend is idempotent too). The ack is applied to the cache in
     * addition to the room echo, so a missed broadcast still converges.
     */
    const pin = useCallback(
        async (messageId: number): Promise<void> => {
            if (pinInFlightRef.current.has(messageId)) {
                return;
            }
            pinInFlightRef.current.add(messageId);
            setPinningIds((current) => new Set(current).add(messageId));
            try {
                const result = await pinChatMessage(chatId, messageId);
                if (result === null) {
                    return;
                }
                const pinned = toChatMessage(result.message);
                if (pinned.id === null) {
                    return;
                }
                applyToCache((current) =>
                    applyPinnedState(
                        current,
                        pinned.id as number,
                        true,
                        pinned.pinnedAtIso,
                    ),
                );
                queryClient.setQueryData<ConversationDetail>(
                    messagesQueryKey(chatId),
                    (current) =>
                        current === undefined
                            ? current
                            : {
                                  ...current,
                                  pinnedMessages: upsertPinnedMessage(
                                      current.pinnedMessages ?? [],
                                      pinned,
                                  ),
                              },
                );
            } finally {
                pinInFlightRef.current.delete(messageId);
                setPinningIds((current) => {
                    const next = new Set(current);
                    next.delete(messageId);
                    return next;
                });
            }
        },
        [chatId, applyToCache, queryClient],
    );

    const unpin = useCallback(
        async (messageId: number): Promise<void> => {
            if (pinInFlightRef.current.has(messageId)) {
                return;
            }
            pinInFlightRef.current.add(messageId);
            setPinningIds((current) => new Set(current).add(messageId));
            try {
                await unpinChatMessage(chatId, messageId);
                applyToCache((current) =>
                    applyPinnedState(current, messageId, false, null),
                );
                queryClient.setQueryData<ConversationDetail>(
                    messagesQueryKey(chatId),
                    (current) =>
                        current === undefined
                            ? current
                            : {
                                  ...current,
                                  pinnedMessages: removePinnedMessage(
                                      current.pinnedMessages ?? [],
                                      messageId,
                                  ),
                              },
                );
            } finally {
                pinInFlightRef.current.delete(messageId);
                setPinningIds((current) => {
                    const next = new Set(current);
                    next.delete(messageId);
                    return next;
                });
            }
        },
        [chatId, applyToCache, queryClient],
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
            // Same for the optimistic path: the viewer is not driven by the
            // message list anymore, so it is told explicitly.
            notifyMediaViewerMessageDeleted(messageId);
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
            isFetched: query.isFetched,
            error: query.error instanceof Error ? query.error : null,
            refetch: (): void => {
                void query.refetch();
            },
            loadingOlder,
            loadOlderError,
            loadOlder,
            ensureActive,
            releaseActive,
            ensureMessageLoaded,
            sending: saveTimestamp,
            sendError,
            send,
            retrySend,
            cancelSend,
            edit,
            remove,
            toggleReaction,
            pin,
            unpin,
            pinningIds,
            reactionError,
            reactingIds,
            mutating,
            gone,
        }),
        [
            detail,
            query.isPending,
            query.isFetched,
            query.error,
            loadingOlder,
            loadOlderError,
            loadOlder,
            ensureActive,
            releaseActive,
            ensureMessageLoaded,
            saveTimestamp,
            sendError,
            send,
            retrySend,
            cancelSend,
            edit,
            remove,
            toggleReaction,
            pin,
            unpin,
            pinningIds,
            reactionError,
            reactingIds,
            mutating,
            gone,
        ],
    );
}
