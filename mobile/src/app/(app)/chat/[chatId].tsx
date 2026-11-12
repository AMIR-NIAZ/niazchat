import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    ActivityIndicator,
    Alert,
    AppState,
    BackHandler,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    AppText,
    GlassHeader,
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
import { ApiError } from '../../../core/api';
import type { ReactionUserDto } from '../../../core/api';
import { useAndroidKeyboardInset } from '../../../shared/hooks/use-android-keyboard-inset';
import {
    DateSeparator,
    ForwardPicker,
    MessageBubble,
    MessageComposer,
    MessageReactionsSheet,
    ScrollToBottomButton,
    UnreadDivider,
    GroupChatSubtitle,
    useChatMessages,
    useMarkSeen,
    useScrollToBottomButton,
    useTypingEmitter,
    useTypingUsers,
    assignMessageRuns,
    formatDaySeparator,
    firstUnreadMessageId,
    highestVisibleMessageId,
    pickReadTarget,
    NO_MESSAGE_ACTIONS,
    getMessageActions,
    isForwardable,
    isOwnMessage,
    pruneForwardSelection,
    selectedMessageIds,
    toReplyPreview,
    toggleForwardSelection,
} from '../../../features/messages';
import type { ChatMessage, MessageActions } from '../../../features/messages';
import type { LocalAttachment } from '../../../features/attachments';
import {
    AttachmentViewer,
    deleteCachedAttachment,
    downloadAttachment,
    mimeForFileName,
    shareLocalFile,
} from '../../../features/attachments';
import {
    getChatDisplay,
    isGroupOwner,
    isPrivateChat,
    purgeChatFromCaches,
    setActiveChat,
    useAddMemberByPhone,
    useBanChatMember,
    useBannedMembers,
    useChatMembers,
    useLeaveChatRoomOnUnmount,
    useLeaveGroup,
} from '../../../features/chats';
import type { ChatMemberRow, ChatRole } from '../../../features/chats';
import { useCurrentUserId } from '../../../features/auth';
import {
    canOpenGroupSettings,
    openMessageLink,
    useGroupInfo,
    useGroupRemovedEvent,
    useGroupUpdatedEvents,
} from '../../../features/groups';
import {
    deleteVoiceFile,
    getVoicePlayback,
    stopVoice,
    voiceCachePath,
} from '../../../features/voice';
import {
    openUserProfile,
    presenceLabel,
    useUserProfile,
} from '../../../features/users';
import { normalizeEmoji, useReactionEmojis } from '../../../features/reactions';

/**
 * Conversation screen (chat list → tap → this screen).
 *
 * Implemented strictly from the documented backend surface:
 * - `joinChat` + `chatInfo` via WS (title/type/avatar/ban state).
 * - History via paginated `getMessages` (first page on join, older pages as the
 *   user scrolls up; the inverted list keeps the newest messages at the bottom).
 * - Live messaging over `sendMessage`/`sendMessage:list`,
 *   `editMessage`/`editMessage:list`, `deleteMessage`/`deleteMessage:list`.
 * - Member management (add-by-phone, banned list) kept from the previous
 *   screen revision, now behind the header admin toggle.
 *
 * Unavailable server-side (not shown): member list for normal members, roles,
 * group rename, read receipts per user, reactions (not implemented in the app).
 */

type ChatDetailRouteParams = { chatId?: string | string[] };

/** Inverted list: offset 0 is the newest message; below it counts as "scrolled up". */
const NEAR_BOTTOM_OFFSET = 80;
/** Jump-to-original cap: 10 pages × 30 messages = 300 messages. */
const JUMP_MAX_PAGES = 10;
const HIGHLIGHT_MS = 1000;
const JUMP_NOTICE_MS = 3000;

type ListChunk =
    | {
          kind: 'message';
          message: ChatMessage;
          showSenderName: boolean;
          showAvatar: boolean;
      }
    | { kind: 'day'; key: string; label: string }
    | { kind: 'unread'; key: string };

export default function ChatDetailScreen(): React.ReactElement {
    const params = useLocalSearchParams<ChatDetailRouteParams>();
    const chatId =
        typeof params.chatId === 'string' ? Number(params.chatId) : Number.NaN;
    const isValid = Number.isInteger(chatId) && chatId > 0;

    // Leaves the chat room on unmount (server triggers `typing:stop` + `seen`).
    useLeaveChatRoomOnUnmount(isValid ? chatId : 0);

    if (!isValid) {
        return <InvalidChat />;
    }
    return <ChatDetail chatId={chatId} />;
}

function ChatDetail({ chatId }: { chatId: number }): React.ReactElement {
    const queryClient = useQueryClient();
    const insets = useSafeAreaInsets();
    const keyboard = useAndroidKeyboardInset(insets.bottom);
    // Session-derived (access-token `sub`), numeric, and stable across profile
    // updates: a `['me']` refetch can never change or lose it.
    const currentUserId = useCurrentUserId();
    const conversation = useChatMessages(chatId, true, currentUserId);
    const [adminPanelOpen, setAdminPanelOpen] = useState(false);
    const [sheetTarget, setSheetTarget] = useState<ChatMessage | null>(null);
    const [reactionsTarget, setReactionsTarget] = useState<ChatMessage | null>(
        null,
    );
    const reactionEmojis = useReactionEmojis();
    const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
    const [actionDraft, setActionDraft] = useState('');
    const [actionError, setActionError] = useState<string | null>(null);
    const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [forwardOpen, setForwardOpen] = useState(false);
    const [viewer, setViewer] = useState<{
        message: ChatMessage;
        index: number;
    } | null>(null);
    const [unreadDividerId, setUnreadDividerId] = useState<number | null>(null);
    const [screenFocused, setScreenFocused] = useState(false);
    const [appActive, setAppActive] = useState(
        AppState.currentState === 'active',
    );

    const detail = conversation.detail;
    const messages = detail?.messages ?? [];
    const info = detail?.info ?? null;
    // Server `type` is the single source of truth; unknown/missing = group.
    const isPrivate = info !== null && isPrivateChat(info);
    const isGroup = !isPrivate;
    // The gear is rendered only after the server says the caller is owner or
    // admin (group info is fetched once per group chat, hidden while unknown).
    const groupInfoQuery = useGroupInfo(isGroup ? chatId : 0);
    useGroupUpdatedEvents();
    const settingsVisible =
        isGroup && canOpenGroupSettings(groupInfoQuery.data?.myRole ?? null);
    const typing = useTypingEmitter(chatId, info !== null);
    const typingUsers = useTypingUsers(chatId, info !== null, currentUserId);
    /** Peer target for the header tap (private chats only). */
    const peerUserId = isPrivate ? (info?.peer?.id ?? null) : null;
    // Presence refresh without new socket events: the public profile is
    // refetched every 30 s while this screen is focused and the app active,
    // plus once on every return to the foreground.
    const presenceQuery = useUserProfile(peerUserId, {
        refetchInterval: screenFocused && appActive ? 30_000 : false,
    });
    const presenceRefetchRef = useRef(presenceQuery.refetch);
    presenceRefetchRef.current = presenceQuery.refetch;
    useEffect((): void => {
        if (peerUserId === null || !screenFocused || !appActive) {
            return;
        }
        presenceRefetchRef.current();
    }, [peerUserId, screenFocused, appActive]);
    const rawMembersCount = info?.membersCount;
    const membersCount =
        rawMembersCount === null || rawMembersCount === undefined
            ? null
            : Number(rawMembersCount);
    /** Caller's own chat role from the `joinChat` ack (`manager` = owner). */
    const myRole: ChatRole | null = info?.myRole ?? null;
    /** `manager` only — chat `admin` is NOT the owner. */
    const isOwner = isGroupOwner(myRole);

    const sheetActions = useMemo(
        () =>
            sheetTarget === null
                ? NO_MESSAGE_ACTIONS
                : getMessageActions(sheetTarget, {
                      currentUserId,
                      canDeleteOthers: isGroup && isOwner,
                  }),
        [sheetTarget, currentUserId, isGroup, isOwner],
    );

    /**
     * Ascending list with day separators and a one-shot unread divider before
     * the first unread message (snapshotted when the chat opens).
     */
    const listData = useMemo<List[]>(() => {
        const list: List[] = [];
        // Sender runs are derived from the merged list on every change, so
        // pagination, live messages, edits and deletes regroup themselves.
        const runs = assignMessageRuns(messages, {
            isGroup,
            currentUserId,
            dividerMessageId: unreadDividerId,
        });
        for (let index = 0; index < runs.length; index += 1) {
            const run = runs[index];
            if (run === undefined) {
                continue;
            }
            const message = run.message;
            if (run.startsNewDay) {
                const previous = runs[index - 1]?.message;
                list.push({
                    kind: 'day',
                    key: `day-${message.createdAtIso}`,
                    label:
                        formatDaySeparator(
                            previous?.createdAtIso ?? message.createdAtIso,
                            message.createdAtIso,
                        ) ?? '',
                });
            }
            if (unreadDividerId !== null && message.id === unreadDividerId) {
                list.push({ kind: 'unread', key: 'new-messages' });
            }
            list.push({
                kind: 'message',
                message,
                showSenderName: run.showSenderName,
                showAvatar: run.showAvatar,
            });
        }
        return list;
    }, [messages, unreadDividerId, isGroup, currentUserId]);

    const replyPreview = useMemo(
        () => (replyTarget === null ? null : toReplyPreview(replyTarget)),
        [replyTarget],
    );

    const listRef = useRef<FlatList<List>>(null);
    const atBottomRef = useRef(true);
    const initialScrollDoneRef = useRef(false);
    const jumpInProgressRef = useRef(false);
    const jumpAbortRef = useRef<AbortController | null>(null);
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [atBottom, setAtBottom] = useState(true);
    const [highestVisibleId, setHighestVisibleId] = useState<number | null>(
        null,
    );
    const [readTrackingReady, setReadTrackingReady] = useState(false);
    const readTrackingReadyRef = useRef(false);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const newMessageCountRef = useRef(0);
    const lastNewestIdRef = useRef<number | null>(null);
    const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
    const [jumpLoadingId, setJumpLoadingId] = useState<number | null>(null);
    const [jumpNotice, setJumpNotice] = useState<string | null>(null);

    /** Visual (inverted) order: newest first, day separators included. */
    const reversedListData = useMemo<List[]>(() => {
        return [...listData].reverse();
    }, [listData]);
    const reversedListDataRef = useRef<List[]>(reversedListData);
    reversedListDataRef.current = reversedListData;

    // Only rows the user can actually see may advance the read position. The
    // callback identity must stay stable across renders (FlatList requirement).
    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 40,
    }).current;
    const onViewableItemsChanged = useRef(
        (info: { viewableItems: ChatViewToken[] }): void => {
            if (!readTrackingReadyRef.current) {
                return;
            }
            const rows: List[] = [];
            for (const token of info.viewableItems) {
                if (token.item !== undefined) {
                    rows.push(token.item);
                }
            }
            const id = highestVisibleMessageId(rows);
            if (id !== null) {
                setHighestVisibleId((current) =>
                    current === id ? current : id,
                );
            }
        },
    ).current;

    // Floating "scroll to latest" button. The list is inverted, so the newest
    // message sits at offset 0; the hook owns the show/hide hysteresis.
    const scrollToLatestButton = useScrollToBottomButton({
        listRef,
        inverted: true,
        onBottomReached: (): void => {
            newMessageCountRef.current = 0;
            setNewMessageCount(0);
        },
    });

    // A new chat starts with no reply, no divider, no selection and no
    // initial-scroll state.
    useEffect((): void => {
        setReplyTarget(null);
        setUnreadDividerId(null);
        setSelecting(false);
        setSelectedIds(new Set());
        setForwardOpen(false);
        setHighestVisibleId(null);
        setReadTrackingReady(false);
        readTrackingReadyRef.current = false;
        // A newly opened chat starts at its newest item until the divider
        // effect says otherwise.
        atBottomRef.current = true;
        setAtBottom(true);
        initialScrollDoneRef.current = false;
    }, [chatId]);

    // Live arrival/deletion never invalidates the id-based selection: only ids
    // that were actually deleted disappear from it.
    useEffect((): void => {
        setSelectedIds((current) => {
            const next = pruneForwardSelection(current, messages);
            return next.size === current.size ? current : next;
        });
    }, [messages]);

    useEffect((): (() => void) | undefined => {
        if (!selecting) return undefined;
        const subscription = BackHandler.addEventListener(
            'hardwareBackPress',
            (): boolean => {
                setSelecting(false);
                setSelectedIds(new Set());
                return true;
            },
        );
        return (): void => subscription.remove();
    }, [selecting]);

    // Focus/foreground drive "actually looking at this chat" for markSeen.
    //
    // Focus also owns the single socket chat room: React Navigation keeps a
    // chat screen mounted when another screen is pushed on top, while the
    // backend only allows one active chat room per socket. Leaving on blur and
    // re-joining on focus keeps room membership, live `seen`/message events and
    // therefore read receipts aligned with what is actually on screen.
    const ensureActiveRef = useRef(conversation.ensureActive);
    ensureActiveRef.current = conversation.ensureActive;
    const releaseActiveRef = useRef(conversation.releaseActive);
    releaseActiveRef.current = conversation.releaseActive;
    useFocusEffect(
        useCallback((): (() => void) => {
            setScreenFocused(true);
            ensureActiveRef.current();
            return (): void => {
                setScreenFocused(false);
                releaseActiveRef.current();
            };
        }, []),
    );
    useEffect((): (() => void) => {
        const subscription = AppState.addEventListener(
            'change',
            (state): void => setAppActive(state === 'active'),
        );
        return (): void => subscription.remove();
    }, []);

    // First load: snapshot the unread block, position the list on its first
    // message, and only then enable read tracking.
    //
    // This is deliberately ONE effect. The snapshot and the initial
    // positioning must be driven by the same `detail`/`messages` pass: when
    // the snapshot was set by a separate effect, this effect ran with a stale
    // `unreadDividerId` (still null in the commit that set it), enabled read
    // tracking with no target, and never scrolled to the divider. The
    // viewability callback had already fired before tracking was enabled, so
    // `highestVisibleId` stayed null and no read receipt was sent until the
    // list changed again (e.g. the user sent a message).
    //
    // Later markSeen calls advance the read position but must not hide the
    // one-shot divider anchor.
    useEffect((): void => {
        if (
            initialScrollDoneRef.current ||
            detail === null ||
            messages.length === 0
        ) {
            return;
        }
        initialScrollDoneRef.current = true;

        const dividerId = firstUnreadMessageId({
            messages,
            myLastSeenId: detail.myLastSeenId,
            currentUserId,
        });

        if (dividerId === null) {
            // Already at the newest message: the newest id is the read target.
            readTrackingReadyRef.current = true;
            setReadTrackingReady(true);
            return;
        }

        setUnreadDividerId(dividerId);
        // Opening on the divider is not "at the bottom": the read target is
        // the divider's message, not the newest one.
        atBottomRef.current = false;
        setAtBottom(false);

        const index = reversedListData.findIndex(
            (item) => item.kind === 'message' && item.message.id === dividerId,
        );
        if (index < 0) {
            // The divider row is not addressable (filtered or not laid out):
            // still make its message the initial target rather than none.
            readTrackingReadyRef.current = true;
            setReadTrackingReady(true);
            setHighestVisibleId((current) => current ?? dividerId);
            return;
        }
        setTimeout((): void => {
            listRef.current?.scrollToIndex({
                index,
                viewPosition: 0.5,
                animated: false,
            });
            // Enable only after the jump so the initial bottom render cannot
            // mark the whole unread block read before it is shown. The
            // divider's message is visible at the centre of the jump and is
            // the initial read target.
            readTrackingReadyRef.current = true;
            setReadTrackingReady(true);
            setHighestVisibleId((current) => current ?? dividerId);
        }, 50);
    }, [detail, messages, currentUserId, reversedListData]);

    useEffect((): (() => void) => {
        return (): void => {
            jumpAbortRef.current?.abort();
            stopVoice();
            if (highlightTimerRef.current !== null) {
                clearTimeout(highlightTimerRef.current);
            }
            if (noticeTimerRef.current !== null) {
                clearTimeout(noticeTimerRef.current);
            }
        };
    }, [chatId]);

    // Composing a reply to a message that gets deleted drops the reply state.
    useEffect((): void => {
        if (replyTarget === null || replyTarget.id === null) {
            return;
        }
        const stillLoaded = messages.some(
            (message) => message.id === replyTarget.id,
        );
        if (!stillLoaded) {
            setReplyTarget(null);
        }
    }, [messages, replyTarget]);

    // A viewer showing a message deleted by anyone closes with it, so video
    // playback never continues for a message that no longer exists.
    useEffect((): void => {
        if (viewer === null || viewer.message.id === null) return;
        if (!messages.some((message) => message.id === viewer.message.id)) {
            setViewer(null);
        }
    }, [messages, viewer]);

    const newestKey =
        messages.length > 0
            ? (messages[messages.length - 1]?.key ?? null)
            : null;

    const newestConfirmedId = useMemo((): number | null => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const id = messages[index]?.id ?? null;
            if (id !== null) {
                return id;
            }
        }
        return null;
    }, [messages]);

    // Focus + foreground + a settled initial position is what allows reads;
    // the target is either the newest message (at the bottom) or the highest
    // message actually visible (while reading back through history).
    const readingNow = screenFocused && appActive && atBottom;
    const readTargetId = pickReadTarget({
        atBottom,
        newestConfirmedId,
        highestVisibleId,
    });
    useMarkSeen(
        chatId,
        readTargetId,
        screenFocused && appActive && readTrackingReady,
    );
    useEffect((): void => {
        setActiveChat(chatId, readingNow);
    }, [chatId, readingNow]);
    useEffect((): (() => void) => {
        return (): void => setActiveChat(null, false);
    }, [chatId]);

    // Auto-scroll ONLY when already at the newest message (first load, own send,
    // or a live message while near the bottom). Reading old history is never
    // yanked, and a live message never hijacks an in-progress jump.
    //
    // The same effect feeds the button badge: a newest id that jumps forward
    // (a live message, never an older `loadOlder` page) from another member
    // while scrolled up counts once. Own and pending/failed messages have no
    // confirmed id newer than the previous newest, so they never count.
    useEffect((): void => {
        if (newestKey === null) {
            return;
        }
        const newest = messages[messages.length - 1];
        const previousId = lastNewestIdRef.current;
        lastNewestIdRef.current = newest?.id ?? null;
        const liveFromOther =
            newest !== undefined &&
            newest.id !== null &&
            newest.status === 'sent' &&
            previousId !== null &&
            newest.id > previousId &&
            !isOwnMessage(currentUserId, newest.senderId);
        if (liveFromOther && !atBottomRef.current) {
            newMessageCountRef.current = Math.min(
                newMessageCountRef.current + 1,
                999,
            );
            setNewMessageCount(newMessageCountRef.current);
        }
        if (jumpInProgressRef.current) {
            return;
        }
        if (atBottomRef.current) {
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }
    }, [newestKey, messages, currentUserId]);

    const scrollToBottom = (): void => {
        atBottomRef.current = true;
        setAtBottom(true);
        newMessageCountRef.current = 0;
        setNewMessageCount(0);
        scrollToLatestButton.scrollToBottom();
    };

    const showJumpNotice = (text: string): void => {
        setJumpNotice(text);
        if (noticeTimerRef.current !== null) {
            clearTimeout(noticeTimerRef.current);
        }
        noticeTimerRef.current = setTimeout((): void => {
            setJumpNotice(null);
        }, JUMP_NOTICE_MS);
    };

    const cancelJump = (): void => {
        jumpAbortRef.current?.abort();
        jumpAbortRef.current = null;
        jumpInProgressRef.current = false;
        setJumpLoadingId(null);
    };

    // Button tap: an in-progress jump-to-original must not fight this scroll.
    const handleScrollToLatest = (): void => {
        cancelJump();
        scrollToBottom();
    };

    const performJump = (messageId: number): void => {
        jumpInProgressRef.current = true;
        setJumpLoadingId(null);
        atBottomRef.current = false;
        // Let a just-loaded page reach the list data before measuring it.
        setTimeout((): void => {
            const index = reversedListDataRef.current.findIndex(
                (item) =>
                    item.kind === 'message' && item.message.id === messageId,
            );
            if (index < 0) {
                jumpInProgressRef.current = false;
                return;
            }
            listRef.current?.scrollToIndex({
                index,
                viewPosition: 0.5,
                animated: true,
            });
            setHighlightedKey(String(messageId));
            if (highlightTimerRef.current !== null) {
                clearTimeout(highlightTimerRef.current);
            }
            highlightTimerRef.current = setTimeout((): void => {
                setHighlightedKey(null);
                jumpInProgressRef.current = false;
            }, HIGHLIGHT_MS);
        }, 50);
    };

    const handleReplyPress = (replyId: number): void => {
        cancelJump();
        const controller = new AbortController();
        jumpAbortRef.current = controller;

        if (messages.some((message) => message.id === replyId)) {
            performJump(replyId);
            return;
        }
        if (detail === null || !detail.hasMore) {
            showJumpNotice('The original message is too old to show');
            return;
        }

        jumpInProgressRef.current = true;
        setJumpLoadingId(replyId);
        void conversation
            .ensureMessageLoaded(replyId, {
                maxPages: JUMP_MAX_PAGES,
                signal: controller.signal,
            })
            .then((outcome): void => {
                if (controller.signal.aborted) {
                    return;
                }
                jumpAbortRef.current = null;
                if (outcome === 'found') {
                    performJump(replyId);
                    return;
                }
                jumpInProgressRef.current = false;
                setJumpLoadingId(null);
                if (outcome === 'not_found') {
                    showJumpNotice('The original message is too old to show');
                }
                // 'error': the existing load-older retry row is shown.
                // 'cancelled': leave the user's scroll position untouched.
            });
    };

    const handleSend = (
        content: string,
        attachments: LocalAttachment[] = [],
    ): void => {
        typing.stopTyping();
        conversation.send(content, { replyTo: replyPreview, attachments });
        setReplyTarget(null);
        scrollToBottom();
    };

    const exitSelection = (): void => {
        setSelecting(false);
        setSelectedIds(new Set());
        setForwardOpen(false);
    };

    const beginSelection = (message: ChatMessage): void => {
        if (!isForwardable(message) || message.id === null) return;
        setSheetTarget(null);
        setSelecting(true);
        setSelectedIds(new Set([message.id]));
    };

    /** Invite links open the join screen; other URLs leave the app. */
    const handleOpenLink = (url: string): void => {
        if (selecting) return;
        openMessageLink(url);
    };

    const handleToggleSelection = (message: ChatMessage): void => {
        const result = toggleForwardSelection(selectedIds, message);
        if (result.limitReached) {
            showJumpNotice('You can forward up to 20 messages at once');
            return;
        }
        setSelectedIds(result.selected);
    };

    const handleOpenForward = (message: ChatMessage | null): void => {
        if (message === null || message.id === null) return;
        setSheetTarget(null);
        setSelecting(true);
        setSelectedIds(new Set([message.id]));
        setForwardOpen(true);
    };

    const handleForwardFinished = (
        successCount: number,
        targetChatIds: number[],
    ): void => {
        exitSelection();
        if (targetChatIds.length === 1) {
            const target = targetChatIds[0];
            if (target !== undefined && target !== chatId) {
                router.push(`/(app)/chat/${target}`);
                return;
            }
        }
        if (successCount > 0) {
            showJumpNotice(
                successCount === 1
                    ? 'Forwarded to 1 chat'
                    : `Forwarded to ${successCount} chats`,
            );
        }
    };

    const handleListScroll = (
        event: NativeSyntheticEvent<NativeScrollEvent>,
    ): void => {
        scrollToLatestButton.onScroll(event);
        const nearBottom =
            event.nativeEvent.contentOffset.y <= NEAR_BOTTOM_OFFSET;
        if (atBottomRef.current !== nearBottom) {
            atBottomRef.current = nearBottom;
            setAtBottom(nearBottom);
        }
        if (nearBottom && newMessageCountRef.current !== 0) {
            newMessageCountRef.current = 0;
            setNewMessageCount(0);
        }
    };

    /**
     * Header identity comes from `peer` for private chats (name + current
     * photo). An older backend that has no `peer` falls back to the last
     * message from the other participant, never to an empty title.
     */
    const display = getChatDisplay(info);
    const legacyPeer =
        isPrivate && info?.peer == null
            ? (messages.find(
                  (message) => !isOwnMessage(currentUserId, message.senderId),
              ) ?? null)
            : null;
    const name =
        isPrivate && info?.peer == null
            ? (legacyPeer?.senderName ?? 'Private chat')
            : display.title;
    // Server-relative path (group photo or the peer's current photo) so the
    // header asks for a thumbnail rather than the original file.
    const avatarPath =
        display.avatarUri ??
        legacyPeer?.senderAvatarPath ??
        legacyPeer?.senderAvatarUrls[0] ??
        null;
    const headerAvatarUserId = display.userId ?? legacyPeer?.senderId ?? chatId;
    const presenceProfile = presenceQuery.profile;
    const peerPresence = !isPrivate
        ? null
        : presenceProfile !== null
          ? presenceLabel(presenceProfile)
          : info?.peer !== undefined && info?.peer !== null
            ? presenceLabel({
                  isOnline: info.peer.isOnline,
                  lastSeen: info.peer.lastSeen,
              })
            : null;

    /**
     * Runs only after the backend confirms the leave: drop the list row and every
     * conversation cache for this chat, then replace the screen so Back cannot
     * reopen the group from stale data.
     */
    const handleLeftGroup = (): void => {
        purgeChatFromCaches(queryClient, chatId);
        setAdminPanelOpen(false);
        router.replace('/(app)');
    };

    /** Removed by an owner/admin while this chat (or the group panel) is open. */
    const handleRemovedFromGroup = useCallback((): void => {
        purgeChatFromCaches(queryClient, chatId);
        setAdminPanelOpen(false);
        Alert.alert('Removed from group', 'You were removed from this group');
        router.replace('/(app)');
    }, [queryClient, chatId]);
    useGroupRemovedEvent(chatId, handleRemovedFromGroup);

    /** One push for one tap; the group screen is not opened twice. */
    const groupNavRef = useRef(false);
    const openGroupInfo = (): void => {
        if (groupNavRef.current) return;
        groupNavRef.current = true;
        router.push(`/(app)/group/${chatId}`);
        setTimeout((): void => {
            groupNavRef.current = false;
        }, 700);
    };

    /** Pushing settings keeps the chat mounted (scroll position + draft). */
    const settingsNavRef = useRef(false);
    const openGroupSettings = (): void => {
        if (settingsNavRef.current) return;
        settingsNavRef.current = true;
        router.push(`/(app)/group-settings/${chatId}`);
        setTimeout((): void => {
            settingsNavRef.current = false;
        }, 700);
    };

    // Without a session user id nothing can be classified as mine: wait for it
    // instead of rendering every bubble on the wrong side. This is session
    // state (not the profile query), so a profile/me refetch never returns here.
    if (conversation.isLoading || currentUserId === null) {
        return <LoadingBlock />;
    }
    if (conversation.error !== null || info === null) {
        return (
            <ErrorBlock
                title="Could not open the chat"
                detail={
                    conversation.error !== null
                        ? conversation.error.message
                        : 'The chat info is unavailable.'
                }
                onRetry={conversation.refetch}
            />
        );
    }

    const headerIdentity = (
        <>
            <UserAvatar
                userId={headerAvatarUserId}
                name={name}
                uri={avatarPath}
                size={40}
            />
            <View style={styles.headerMeta}>
                <Text style={typography.title} numberOfLines={1}>
                    {name}
                </Text>
                {isGroup ? (
                    <GroupChatSubtitle
                        names={typingUsers.map((user) => user.name)}
                        membersCount={
                            membersCount !== null &&
                            Number.isFinite(membersCount)
                                ? membersCount
                                : null
                        }
                        suffix={info.isBan ? ' · banned' : ''}
                    />
                ) : (
                    <GroupChatSubtitle
                        names={[]}
                        membersCount={null}
                        fallbackText={peerPresence ?? ''}
                        typing={typingUsers.length > 0}
                        typingLabel="typing"
                    />
                )}
            </View>
        </>
    );

    return (
        <Screen
            style={[
                styles.screen,
                {
                    // While the keyboard is open it replaces the safe-area
                    // bottom padding; on Android only the part the native
                    // window did not already shrink by is added (measured in
                    // `useAndroidKeyboardInset`, so never twice).
                    paddingBottom: keyboard.open
                        ? keyboard.inset
                        : insets.bottom + spacing.md,
                },
            ]}
            // The container spans the window: its measured bottom edge tells
            // the keyboard hook whether Android already resized it.
            onLayout={keyboard.onContainerLayout}
            withTopInset={true}
            withBottomInset={false}
        >
            {selecting ? (
                <View style={styles.selectionBar}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel selection"
                        style={styles.selectionAction}
                        onPress={exitSelection}
                    >
                        <Text style={styles.selectionCancel}>Cancel</Text>
                    </Pressable>
                    <Text
                        style={styles.selectionCount}
                        accessibilityLabel={`${selectedIds.size} selected`}
                    >
                        {selectedIds.size} selected
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Forward selected messages"
                        accessibilityState={{
                            disabled: selectedIds.size === 0,
                        }}
                        disabled={selectedIds.size === 0}
                        style={[
                            styles.selectionForward,
                            selectedIds.size === 0 &&
                                styles.selectionForwardDisabled,
                        ]}
                        onPress={(): void => setForwardOpen(true)}
                    >
                        <Text style={styles.selectionForwardText}>Forward</Text>
                    </Pressable>
                </View>
            ) : (
                <GlassHeader style={styles.headerBar} layout="row">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                        style={styles.backButton}
                        onPress={(): void => router.back()}
                    >
                        <Text style={styles.backText}>‹</Text>
                    </Pressable>
                    {peerUserId !== null ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Open profile of ${name}`}
                            onPress={(): void => {
                                openUserProfile({
                                    userId: peerUserId,
                                    name,
                                    avatar: avatarPath,
                                });
                            }}
                            style={({ pressed }) => [
                                styles.headerIdentity,
                                pressed && styles.pressed,
                            ]}
                        >
                            {headerIdentity}
                        </Pressable>
                    ) : isGroup ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Open group info for ${name}`}
                            onPress={openGroupInfo}
                            style={({ pressed }) => [
                                styles.headerIdentity,
                                pressed && styles.pressed,
                            ]}
                        >
                            {headerIdentity}
                        </Pressable>
                    ) : (
                        headerIdentity
                    )}
                    {isGroup && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Open chat admin panel"
                            style={styles.pillButton}
                            onPress={(): void => setAdminPanelOpen(true)}
                        >
                            <Text style={styles.pillText}>Admin</Text>
                        </Pressable>
                    )}
                    {settingsVisible && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Group settings"
                            style={({ pressed }) => [
                                styles.iconButton,
                                pressed && styles.pressed,
                            ]}
                            onPress={openGroupSettings}
                        >
                            <Text style={styles.gearGlyph}>⚙</Text>
                        </Pressable>
                    )}
                </GlassHeader>
            )}

            {messages.length === 0 ? (
                <View style={styles.emptyState}>
                    <AppText variant="title">No messages yet</AppText>
                    <AppText variant="caption" style={styles.emptyCaption}>
                        Say hello — messages are delivered over WebSocket.
                    </AppText>
                </View>
            ) : (
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={styles.chatArea}
                    keyboardVerticalOffset={
                        Platform.OS === 'ios' ? spacing.lg : 0
                    }
                >
                    <FlatList
                        ref={listRef}
                        inverted={true}
                        style={styles.list}
                        contentContainerStyle={styles.listContent}
                        keyExtractor={(chunk): string =>
                            chunk.kind === 'message'
                                ? `m-${chunk.message.key}`
                                : chunk.kind === 'unread'
                                  ? `u-${chunk.key}`
                                  : `d-${chunk.key}`
                        }
                        keyboardShouldPersistTaps="handled"
                        onScrollBeginDrag={(): void => {
                            cancelJump();
                            scrollToLatestButton.cancelScrollToBottom();
                            Keyboard.dismiss();
                        }}
                        onScroll={handleListScroll}
                        onViewableItemsChanged={onViewableItemsChanged}
                        viewabilityConfig={viewabilityConfig}
                        onLayout={scrollToLatestButton.onLayout}
                        onContentSizeChange={
                            scrollToLatestButton.onContentSizeChange
                        }
                        scrollEventThrottle={16}
                        // Inverted: the visual top is the END of the data, so
                        // this fires when the user nears the oldest message.
                        onEndReached={(): void => conversation.loadOlder()}
                        onEndReachedThreshold={0.4}
                        onScrollToIndexFailed={(info): void => {
                            // Variable row heights: jump approximately, then
                            // retry the exact target once rows are measured.
                            listRef.current?.scrollToOffset({
                                offset: info.averageItemLength * info.index,
                                animated: false,
                            });
                            setTimeout((): void => {
                                listRef.current?.scrollToIndex({
                                    index: info.index,
                                    viewPosition: 0.5,
                                    animated: true,
                                });
                            }, 120);
                        }}
                        ListFooterComponent={
                            conversation.loadingOlder ? (
                                <View style={styles.olderRow}>
                                    <ActivityIndicator
                                        size="small"
                                        color={palette.primary[500]}
                                    />
                                </View>
                            ) : conversation.loadOlderError !== null ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Retry loading older messages"
                                    style={styles.olderRow}
                                    onPress={(): void =>
                                        conversation.loadOlder()
                                    }
                                >
                                    <Text style={styles.olderRetryText}>
                                        Couldn&apos;t load older messages ·
                                        Retry
                                    </Text>
                                </Pressable>
                            ) : undefined
                        }
                        data={reversedListData}
                        extraData={`${selecting}:${[...selectedIds].join(',')}`}
                        renderItem={({ item }): React.ReactElement => {
                            if (item.kind === 'unread') {
                                return (
                                    <View style={styles.daySlot}>
                                        <UnreadDivider />
                                    </View>
                                );
                            }
                            if (item.kind === 'day') {
                                return (
                                    <View style={styles.daySlot}>
                                        <DateSeparator label={item.label} />
                                    </View>
                                );
                            }
                            const message = item.message;
                            // Both ids normalized to numbers (a bigint-string
                            // id can never flip the whole history to "theirs").
                            const mine = isOwnMessage(
                                currentUserId,
                                message.senderId,
                            );
                            return (
                                <MessageBubble
                                    message={message}
                                    mine={mine}
                                    isGroup={isGroup}
                                    currentUserId={currentUserId}
                                    showSenderName={item.showSenderName}
                                    showAvatar={item.showAvatar}
                                    onOpenLink={
                                        selecting ? undefined : handleOpenLink
                                    }
                                    onOpenProfile={
                                        selecting
                                            ? undefined
                                            : (sender): void => {
                                                  openUserProfile({
                                                      userId: sender.senderId,
                                                      name: sender.senderName,
                                                      avatar: sender.senderAvatarPath,
                                                  });
                                              }
                                    }
                                    onForwardedProfilePress={(
                                        userId,
                                        forwardedName,
                                    ): void => {
                                        openUserProfile({
                                            userId,
                                            name: forwardedName,
                                            isSelf: isOwnMessage(
                                                currentUserId,
                                                userId,
                                            ),
                                        });
                                    }}
                                    selectionMode={selecting}
                                    selected={
                                        message.id !== null &&
                                        selectedIds.has(message.id)
                                    }
                                    onToggleSelect={handleToggleSelection}
                                    highlighted={highlightedKey === message.key}
                                    othersLastSeenId={
                                        detail?.othersLastSeenId ?? null
                                    }
                                    // Any confirmed message can be replied to;
                                    // pending/failed bubbles cannot.
                                    onLongPress={
                                        !selecting &&
                                        message.status === 'sent' &&
                                        message.id !== null
                                            ? (): void =>
                                                  setSheetTarget(message)
                                            : undefined
                                    }
                                    onReplyPress={
                                        selecting ? undefined : handleReplyPress
                                    }
                                    onRetryFailed={
                                        selecting
                                            ? undefined
                                            : (failed): void =>
                                                  conversation.retrySend(
                                                      failed.key,
                                                  )
                                    }
                                    onRetryPending={
                                        selecting
                                            ? undefined
                                            : (pending): void =>
                                                  conversation.retrySend(
                                                      pending.key,
                                                  )
                                    }
                                    onCancelPending={
                                        selecting
                                            ? undefined
                                            : (pending): void =>
                                                  conversation.cancelSend(
                                                      pending.key,
                                                  )
                                    }
                                    onRemovePending={
                                        selecting
                                            ? undefined
                                            : (pending): void =>
                                                  conversation.cancelSend(
                                                      pending.key,
                                                  )
                                    }
                                    onOpenMedia={
                                        selecting
                                            ? undefined
                                            : (source, mediaIndex): void =>
                                                  setViewer({
                                                      message: source,
                                                      index: mediaIndex,
                                                  })
                                    }
                                    onToggleReaction={
                                        selecting
                                            ? undefined
                                            : (message, emoji): void => {
                                                  if (message.id === null) {
                                                      return;
                                                  }
                                                  void conversation.toggleReaction(
                                                      message.id,
                                                      emoji,
                                                  );
                                              }
                                    }
                                    onOpenReactions={
                                        selecting
                                            ? undefined
                                            : (message): void =>
                                                  setReactionsTarget(message)
                                    }
                                />
                            );
                        }}
                    />
                    {jumpLoadingId !== null && (
                        <View style={styles.jumpBanner} pointerEvents="none">
                            <ActivityIndicator
                                size="small"
                                color={palette.primary[500]}
                            />
                            <Text style={styles.jumpBannerText}>
                                Looking for the message…
                            </Text>
                        </View>
                    )}
                    <ScrollToBottomButton
                        visible={scrollToLatestButton.visible}
                        count={newMessageCount}
                        onPress={handleScrollToLatest}
                    />
                </KeyboardAvoidingView>
            )}

            {conversation.sendError !== null && (
                <Text style={styles.sendError}>{conversation.sendError}</Text>
            )}
            {conversation.reactionError !== null && (
                <Text style={styles.sendError}>
                    {conversation.reactionError}
                </Text>
            )}

            {jumpNotice !== null && (
                <Text style={styles.jumpNotice}>{jumpNotice}</Text>
            )}

            <MessageComposer
                chatId={chatId}
                disabled={conversation.sending !== null}
                onSend={handleSend}
                replyTo={replyPreview}
                currentUserId={currentUserId}
                onCancelReply={(): void => setReplyTarget(null)}
                onTextChange={typing.onChangeText}
                onBlur={typing.onBlur}
            />

            <MessageActionSheet
                target={sheetTarget}
                actions={sheetActions}
                reactionEmojis={reactionEmojis}
                myReaction={sheetTarget?.myReaction ?? null}
                canReact={
                    sheetTarget !== null &&
                    sheetTarget.id !== null &&
                    sheetTarget.status === 'sent' &&
                    !sheetTarget.isDeleted
                }
                reacting={
                    sheetTarget?.id !== null &&
                    sheetTarget?.id !== undefined &&
                    conversation.reactingIds.has(sheetTarget.id)
                }
                onReact={(emoji): void => {
                    const target = sheetTarget;
                    setSheetTarget(null);
                    if (target === null || target.id === null) return;
                    void conversation.toggleReaction(target.id, emoji);
                }}
                onForward={(): void => handleOpenForward(sheetTarget)}
                onSelect={(): void => {
                    const target = sheetTarget;
                    if (target !== null) beginSelection(target);
                }}
                onReply={(): void => {
                    const target = sheetTarget;
                    setSheetTarget(null);
                    if (
                        target === null ||
                        target.id === null ||
                        target.status !== 'sent'
                    ) {
                        return;
                    }
                    setReplyTarget(target);
                }}
                onEdit={(): void => {
                    onActionPress(sheetTarget);
                    setSheetTarget(null);
                }}
                onShare={(): void => {
                    const target = sheetTarget;
                    setSheetTarget(null);
                    if (target === null) return;
                    const document = target.attachments.find(
                        (attachment) =>
                            attachment.kind === 'file' &&
                            attachment.id !== null,
                    );
                    if (document === undefined || document.id === null) return;
                    void downloadAttachment(
                        {
                            id: document.id,
                            name: document.name,
                            mimeType: document.mimeType,
                        },
                        undefined,
                    )
                        .then((path) =>
                            shareLocalFile(
                                path,
                                mimeForFileName(
                                    document.name,
                                    document.mimeType,
                                ),
                                document.name,
                            ),
                        )
                        .catch((error: unknown) =>
                            Alert.alert(
                                'Could not share file',
                                error instanceof Error
                                    ? error.message
                                    : 'Share failed.',
                            ),
                        );
                }}
                onDelete={(): void => {
                    const target = sheetTarget;
                    setSheetTarget(null);
                    if (
                        target === null ||
                        target.id === null ||
                        conversation.mutating
                    ) {
                        return;
                    }
                    const deletingOtherMember = !isOwnMessage(
                        currentUserId,
                        target.senderId,
                    );
                    const hasVoice = target.attachments.some(
                        (attachment) => attachment.kind === 'voice',
                    );
                    const hasAttachments = target.attachments.length > 0;
                    const explanation = deletingOtherMember
                        ? 'This message belongs to another member and will be removed for everyone in the group.'
                        : hasVoice
                          ? 'This voice message will be removed for everyone.'
                          : hasAttachments
                            ? 'This message and its attachments will be removed for everyone.'
                            : 'This message will be removed for everyone.';
                    Alert.alert(
                        deletingOtherMember
                            ? 'Delete for everyone?'
                            : 'Delete message?',
                        explanation,
                        [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: (): void => {
                                    const messageId = target.id;
                                    if (messageId === null) {
                                        return;
                                    }
                                    if (viewer?.message.id === messageId) {
                                        setViewer(null);
                                    }
                                    if (
                                        target.attachments.some(
                                            (attachment) =>
                                                attachment.id !== null &&
                                                attachment.id ===
                                                    getVoicePlayback()
                                                        .attachmentId,
                                        )
                                    ) {
                                        stopVoice();
                                    }
                                    void conversation
                                        .remove(messageId)
                                        .then((): void => {
                                            for (const attachment of target.attachments) {
                                                if (attachment.id === null) {
                                                    continue;
                                                }
                                                void deleteCachedAttachment(
                                                    attachment.id,
                                                );
                                                if (
                                                    attachment.kind === 'voice'
                                                ) {
                                                    const path = voiceCachePath(
                                                        attachment.id,
                                                        attachment.mimeType,
                                                    );
                                                    if (path !== null) {
                                                        void deleteVoiceFile(
                                                            path,
                                                        );
                                                    }
                                                }
                                            }
                                        })
                                        .catch((error: unknown) =>
                                            Alert.alert(
                                                'Could not delete message',
                                                error instanceof Error
                                                    ? error.message
                                                    : 'Delete failed.',
                                            ),
                                        );
                                },
                            },
                        ],
                    );
                }}
                onDismiss={(): void => setSheetTarget(null)}
            />

            <MessageReactionsSheet
                chatId={chatId}
                target={reactionsTarget}
                currentUserId={currentUserId}
                onClose={(): void => setReactionsTarget(null)}
                onOpenUser={(user: ReactionUserDto): void => {
                    setReactionsTarget(null);
                    openUserProfile({
                        userId: user.userId,
                        name: user.name,
                        avatar: user.avatars[0] ?? null,
                        isSelf:
                            currentUserId !== null &&
                            Number(user.userId) === Number(currentUserId),
                    });
                }}
            />

            <MessageActionModal
                visible={actionTarget !== null}
                target={actionTarget}
                draft={actionDraft}
                busy={conversation.mutating}
                error={actionError}
                onDraftChange={setActionDraft}
                onDismiss={(): void => {
                    setActionTarget(null);
                    setActionDraft('');
                    setActionError(null);
                }}
                onSave={(content): void => {
                    const target = actionTarget;
                    if (target === null || target.id === null) {
                        return;
                    }
                    setActionError(null);
                    conversation
                        .edit(target.id, content)
                        .then(() => {
                            setActionTarget(null);
                            setActionDraft('');
                        })
                        .catch((error: unknown) =>
                            setActionError(
                                error instanceof Error
                                    ? error.message
                                    : 'Edit failed.',
                            ),
                        );
                }}
            />

            <ForwardPicker
                visible={forwardOpen}
                sourceChatId={chatId}
                messageIds={selectedMessageIds(selectedIds)}
                onClose={(): void => setForwardOpen(false)}
                onFinished={handleForwardFinished}
            />

            <AttachmentViewer
                visible={viewer !== null}
                media={
                    viewer === null
                        ? []
                        : viewer.message.attachments.filter(
                              (attachment) =>
                                  attachment.kind === 'image' ||
                                  attachment.kind === 'video',
                          )
                }
                initialIndex={viewer?.index ?? 0}
                onClose={(): void => setViewer(null)}
            />

            {isGroup && (
                <AdminPanel
                    visible={adminPanelOpen}
                    chatId={chatId}
                    isGroup={isGroup}
                    myRole={myRole}
                    isOwner={isOwner}
                    currentUserId={currentUserId}
                    onClose={(): void => setAdminPanelOpen(false)}
                    onLeft={handleLeftGroup}
                />
            )}
        </Screen>
    );

    function onActionPress(message: ChatMessage | null): void {
        if (message === null) {
            return;
        }
        setActionTarget(message);
        setActionDraft(message.content ?? '');
        setActionError(null);
    }
}

type List = ListChunk;

/** Minimal viewability token (RN no longer exports `ViewToken`). */
interface ChatViewToken {
    item?: List | undefined;
}

/// Long-press action sheet (Reply / Edit / Delete / Cancel) --------------------

interface MessageActionSheetProps {
    target: ChatMessage | null;
    actions: MessageActions;
    reactionEmojis: string[];
    myReaction: string | null;
    canReact: boolean;
    reacting: boolean;
    onReact: (emoji: string) => void;
    onReply: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onForward: () => void;
    onShare: () => void;
    onSelect: () => void;
    onDismiss: () => void;
}

function MessageActionSheet(
    props: MessageActionSheetProps,
): React.ReactElement {
    if (props.target === null) {
        return <View />;
    }
    return (
        <Modal
            visible={true}
            transparent={true}
            animationType="slide"
            onRequestClose={props.onDismiss}
        >
            <Pressable style={styles.sheetBackdrop} onPress={props.onDismiss}>
                <Pressable style={styles.sheetCard}>
                    {props.canReact && (
                        <View style={styles.quickReactions}>
                            <ScrollView
                                horizontal={true}
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={
                                    styles.quickReactionsContent
                                }
                            >
                                {props.reactionEmojis.map((emoji) => {
                                    const selected =
                                        props.myReaction !== null &&
                                        normalizeEmoji(props.myReaction) ===
                                            normalizeEmoji(emoji);
                                    return (
                                        <Pressable
                                            key={emoji}
                                            accessibilityRole="button"
                                            accessibilityLabel={`React ${emoji}`}
                                            accessibilityState={{ selected }}
                                            disabled={props.reacting}
                                            onPress={(): void =>
                                                props.onReact(emoji)
                                            }
                                            style={({ pressed }) => [
                                                styles.quickReaction,
                                                selected &&
                                                    styles.quickReactionSelected,
                                                (pressed || props.reacting) &&
                                                    styles.pressed,
                                            ]}
                                        >
                                            <Text
                                                style={
                                                    styles.quickReactionEmoji
                                                }
                                            >
                                                {emoji}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                                {props.reacting && (
                                    <ActivityIndicator
                                        size="small"
                                        color={palette.primary[500]}
                                    />
                                )}
                            </ScrollView>
                        </View>
                    )}
                    {props.actions.reply && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Reply to message"
                            style={styles.sheetButton}
                            onPress={props.onReply}
                        >
                            <Text style={styles.sheetActionText}>Reply</Text>
                        </Pressable>
                    )}
                    {props.actions.forward && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Forward"
                            style={styles.sheetButton}
                            onPress={props.onForward}
                        >
                            <Text style={styles.sheetActionText}>Forward</Text>
                        </Pressable>
                    )}
                    {props.actions.select && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Select messages"
                            style={styles.sheetButton}
                            onPress={props.onSelect}
                        >
                            <Text style={styles.sheetActionText}>Select</Text>
                        </Pressable>
                    )}
                    {props.actions.share && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Share file"
                            style={styles.sheetButton}
                            onPress={props.onShare}
                        >
                            <Text style={styles.sheetActionText}>Share</Text>
                        </Pressable>
                    )}
                    {props.actions.edit && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={
                                props.actions.editLabel ?? 'Edit'
                            }
                            style={styles.sheetButton}
                            onPress={props.onEdit}
                        >
                            <Text style={styles.sheetActionText}>
                                {props.actions.editLabel ?? 'Edit'}
                            </Text>
                        </Pressable>
                    )}
                    {props.actions.delete && !props.actions.deleteOthers && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Delete message"
                            style={styles.sheetButton}
                            onPress={props.onDelete}
                        >
                            <Text style={styles.sheetDeleteText}>Delete</Text>
                        </Pressable>
                    )}
                    {props.actions.deleteOthers && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Delete message for everyone"
                            style={styles.sheetButton}
                            onPress={props.onDelete}
                        >
                            <Text style={styles.sheetDeleteText}>
                                Delete for everyone
                            </Text>
                        </Pressable>
                    )}
                    <View style={styles.sheetDivider} />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                        style={styles.sheetButton}
                        onPress={props.onDismiss}
                    >
                        <Text style={styles.sheetCancelText}>Cancel</Text>
                    </Pressable>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

/// Message edit modal ----------------------------------------------------------

interface MessageActionModalProps {
    visible: boolean;
    target: ChatMessage | null;
    draft: string;
    busy: boolean;
    error: string | null;
    onDraftChange: (text: string) => void;
    onDismiss: () => void;
    onSave: (newContent: string) => void;
}

function MessageActionModal(
    props: MessageActionModalProps,
): React.ReactElement {
    if (props.target === null) {
        return <View />;
    }
    const trimmed = props.draft.trim();
    const unchanged =
        trimmed === (props.target.content ?? '').trim() || trimmed === '';
    return (
        <Modal
            visible={props.visible}
            transparent={true}
            animationType="fade"
            onRequestClose={props.onDismiss}
        >
            <Pressable style={styles.modalBackdrop} onPress={props.onDismiss}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={styles.modalAvoid}
                    pointerEvents="box-none"
                >
                    <Pressable style={styles.modalCard}>
                        <AppText variant="title">
                            {props.target.attachments.length > 0
                                ? 'Edit caption'
                                : 'Edit message'}
                        </AppText>
                        <TextInput
                            style={styles.modalInput}
                            value={props.draft}
                            onChangeText={props.onDraftChange}
                            multiline={true}
                            maxLength={5000}
                            autoFocus={true}
                        />
                        {props.error !== null && (
                            <Text
                                style={[typography.caption, styles.modalError]}
                            >
                                {props.error}
                            </Text>
                        )}
                        <View style={styles.modalActions}>
                            {props.busy ? (
                                <ActivityIndicator
                                    size="small"
                                    color={palette.primary[500]}
                                />
                            ) : (
                                <>
                                    <FormButtonSmall
                                        label="Save"
                                        disabled={unchanged}
                                        onPress={(): void =>
                                            props.onSave(props.draft.trim())
                                        }
                                    />
                                    <FormButtonSmall
                                        label="Cancel"
                                        onPress={props.onDismiss}
                                    />
                                </>
                            )}
                        </View>
                    </Pressable>
                </KeyboardAvoidingView>
            </Pressable>
        </Modal>
    );
}

/// Admin panel (member add by phone + banned members; previously inline) --------

interface AdminPanelProps {
    visible: boolean;
    chatId: number;
    /** Leave is a group-only action (private chats have no membership row). */
    isGroup: boolean;
    /** Caller's own chat role (`manager` = owner, `admin` ≠ owner). */
    myRole: ChatRole | null;
    /** Owner-only moderation UI; the backend enforces the same rule. */
    isOwner: boolean;
    currentUserId: number | null;
    onClose: () => void;
    /** Called only after the backend confirms the membership removal. */
    onLeft: () => void;
}

function AdminPanel({
    visible,
    chatId,
    isGroup,
    myRole,
    isOwner,
    currentUserId,
    onClose,
    onLeft,
}: AdminPanelProps): React.ReactElement {
    const bans = useBannedMembers(chatId, visible);
    const addMember = useAddMemberByPhone();
    const leaveGroup = useLeaveGroup();
    const members = useChatMembers(chatId, visible && isGroup && isOwner);
    const banMember = useBanChatMember(chatId);
    const [phone, setPhone] = useState('+98');
    const [addFeedback, setAddFeedback] = useState<string | null>(null);
    const [leaveError, setLeaveError] = useState<string | null>(null);
    const [banFeedback, setBanFeedback] = useState<string | null>(null);
    const leaveInFlightRef = useRef(false);
    const banInFlightRef = useRef(false);

    const performBan = async (member: ChatMemberRow): Promise<void> => {
        if (banInFlightRef.current || banMember.isPending) {
            return;
        }
        banInFlightRef.current = true;
        setBanFeedback(null);
        try {
            await banMember.mutateAsync(member.memberId);
            setBanFeedback(`${member.name} was banned from the group.`);
        } catch (error) {
            setBanFeedback(
                error instanceof Error ? error.message : 'Ban failed.',
            );
        } finally {
            banInFlightRef.current = false;
        }
    };

    const confirmBan = (member: ChatMemberRow): void => {
        if (banMember.isPending || banInFlightRef.current) {
            return;
        }
        Alert.alert(
            `Ban ${member.name}?`,
            'They will be removed from the group, disconnected from this chat and unable to rejoin until unbanned. Their messages stay in the conversation.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Ban',
                    style: 'destructive',
                    onPress: (): void => {
                        void performBan(member);
                    },
                },
            ],
        );
    };

    /** Server confirmed (or membership is already gone): clear local access. */
    const finishLeave = (): void => {
        onLeft();
        Alert.alert('Left group', 'You are no longer a member of this group.');
    };

    const performLeave = async (): Promise<void> => {
        if (leaveInFlightRef.current || leaveGroup.isPending) {
            return;
        }
        leaveInFlightRef.current = true;
        setLeaveError(null);
        try {
            await leaveGroup.mutateAsync(chatId);
            finishLeave();
        } catch (error) {
            // 403/404 = the caller is already out (or no longer allowed in):
            // membership is gone server-side, so drop local access too.
            if (
                error instanceof ApiError &&
                (error.statusCode === 403 || error.statusCode === 404)
            ) {
                finishLeave();
                return;
            }
            setLeaveError(
                error instanceof Error
                    ? error.message
                    : 'Could not leave the group.',
            );
        } finally {
            leaveInFlightRef.current = false;
        }
    };

    const confirmLeave = (): void => {
        if (leaveGroup.isPending || leaveInFlightRef.current) {
            return;
        }
        Alert.alert(
            'Leave group?',
            'You will be removed from this group and will no longer receive its messages. An admin will have to add you again.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Leave',
                    style: 'destructive',
                    onPress: (): void => {
                        void performLeave();
                    },
                },
            ],
        );
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <Screen style={styles.adminScreen} withTopInset={true}>
                <View style={styles.adminHeader}>
                    <AppText variant="title">Chat admin</AppText>
                    <Pressable
                        accessibilityRole="button"
                        onPress={onClose}
                        style={styles.pillButton}
                    >
                        <Text style={styles.pillText}>Close</Text>
                    </Pressable>
                </View>

                <View style={styles.section}>
                    <AppText variant="title">Add member (by phone)</AppText>
                    <TextInput
                        style={styles.input}
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        placeholder="+989123456789"
                        placeholderTextColor={palette.neutral[300]}
                    />
                    <FormButtonSmall
                        label={addMember.isPending ? 'Adding…' : 'Add member'}
                        onPress={(): void => {
                            setAddFeedback(null);
                            void addMember
                                .mutateAsync({
                                    groupId: chatId,
                                    phone: phone.trim(),
                                })
                                .then(() => setAddFeedback('Member added.'))
                                .catch((error: unknown) =>
                                    setAddFeedback(
                                        error instanceof Error
                                            ? error.message
                                            : 'Failed.',
                                    ),
                                );
                        }}
                    />
                    {addFeedback !== null && (
                        <Text style={[typography.caption, styles.feedback]}>
                            {addFeedback}
                        </Text>
                    )}
                </View>

                {isOwner && isGroup && (
                    <View style={[styles.section, styles.sectionFlex]}>
                        <AppText variant="title">Members</AppText>
                        {members.isPending ? (
                            <ActivityIndicator size="small" />
                        ) : members.isError ? (
                            <AppText variant="caption" style={styles.feedback}>
                                {members.error.message}
                            </AppText>
                        ) : (
                            <FlatList
                                data={(members.data ?? []).filter(
                                    (member) =>
                                        !isOwnMessage(
                                            currentUserId,
                                            member.userId,
                                        ) && member.role !== 'manager',
                                )}
                                keyExtractor={(item): string =>
                                    String(item.memberId)
                                }
                                ListEmptyComponent={
                                    <AppText variant="caption">
                                        No other members to moderate.
                                    </AppText>
                                }
                                renderItem={({ item }): React.ReactElement => (
                                    <View style={styles.memberRow}>
                                        <View style={styles.memberBody}>
                                            <Text
                                                style={typography.body}
                                                numberOfLines={1}
                                            >
                                                {item.name}
                                            </Text>
                                            <Text
                                                style={typography.caption}
                                                numberOfLines={1}
                                            >
                                                {item.username === null
                                                    ? `#${item.userId}`
                                                    : `@${item.username}`}
                                                {item.role === 'admin'
                                                    ? ' · admin'
                                                    : ''}
                                            </Text>
                                        </View>
                                        <FormButtonSmall
                                            intent="danger"
                                            label={
                                                banMember.isPending &&
                                                banMember.variables ===
                                                    item.memberId
                                                    ? 'Banning…'
                                                    : 'Ban'
                                            }
                                            disabled={banMember.isPending}
                                            onPress={(): void => {
                                                confirmBan(item);
                                            }}
                                        />
                                    </View>
                                )}
                            />
                        )}
                        {banFeedback !== null && (
                            <Text style={[typography.caption, styles.feedback]}>
                                {banFeedback}
                            </Text>
                        )}
                    </View>
                )}

                <View style={[styles.section, styles.sectionFlex]}>
                    <AppText variant="title">Banned members</AppText>
                    {bans.isPending ? (
                        <ActivityIndicator size="small" />
                    ) : bans.isError ? (
                        <AppText variant="caption" style={styles.feedback}>
                            {bansErrorText(bans.error)}
                        </AppText>
                    ) : (bans.data?.length ?? 0) === 0 ? (
                        <AppText variant="caption">No banned members.</AppText>
                    ) : (
                        <FlatList
                            data={bans.data}
                            keyExtractor={(item): string => String(item.id)}
                            renderItem={({ item }): React.ReactElement => (
                                <View style={styles.bannedRow}>
                                    <Text style={typography.body}>
                                        {item.user.name} · {item.user.phone}
                                    </Text>
                                </View>
                            )}
                        />
                    )}
                </View>

                {isGroup && (
                    <View style={styles.section}>
                        <AppText variant="title">Membership</AppText>
                        {isGroupOwner(myRole) ? (
                            <AppText variant="caption" style={styles.feedback}>
                                The group owner cannot leave this group.
                                Ownership transfer is not supported yet.
                            </AppText>
                        ) : myRole === null ? (
                            <AppText variant="caption" style={styles.feedback}>
                                {
                                    'Your role here is unknown, so leaving is disabled.'
                                }
                            </AppText>
                        ) : (
                            <>
                                <AppText
                                    variant="caption"
                                    style={styles.feedback}
                                >
                                    Leaving removes you from this group&apos;s
                                    membership; you will stop receiving its
                                    messages.
                                </AppText>
                                <FormButtonSmall
                                    intent="danger"
                                    label={
                                        leaveGroup.isPending
                                            ? 'Leaving…'
                                            : 'Leave group'
                                    }
                                    disabled={leaveGroup.isPending}
                                    onPress={confirmLeave}
                                />
                                {leaveError !== null && (
                                    <Text
                                        style={[
                                            typography.caption,
                                            styles.leaveError,
                                        ]}
                                    >
                                        {leaveError}
                                    </Text>
                                )}
                            </>
                        )}
                    </View>
                )}
            </Screen>
        </Modal>
    );
}

function bansErrorText(error: Error | null): string {
    const status = (error as { statusCode?: number } | null)?.statusCode;
    return status === 403
        ? 'Not permitted — requires chat-manager rights (or chat-admin with ban_user).'
        : (error?.message ?? 'Failed to load banned members.');
}

/// Skeletons ---------------------------------------------------------------------

function FormButtonSmall(props: {
    label: string;
    onPress: () => void;
    intent?: 'primary' | 'danger';
    disabled?: boolean;
}): React.ReactElement {
    return (
        <Pressable
            accessibilityRole="button"
            style={[
                styles.smallButton,
                props.intent === 'danger' && styles.smallButtonDanger,
                props.disabled === true && styles.smallButtonDisabled,
            ]}
            disabled={props.disabled}
            onPress={props.onPress}
        >
            <Text style={styles.smallButtonText}>{props.label}</Text>
        </Pressable>
    );
}

function LoadingBlock(): React.ReactElement {
    return (
        <Screen style={styles.center}>
            <ActivityIndicator size="large" color={palette.primary[500]} />
        </Screen>
    );
}

function ErrorBlock(props: {
    title: string;
    detail: string;
    onRetry: () => void;
}): React.ReactElement {
    return (
        <Screen style={styles.center}>
            <AppText variant="title">{props.title}</AppText>
            <AppText style={styles.feedback}>{props.detail}</AppText>
            <FormButtonSmall label="Retry" onPress={props.onRetry} />
            <Pressable
                onPress={(): void => router.back()}
                style={styles.smallButtonGhost}
            >
                <Text style={styles.smallButtonGhostText}>Back</Text>
            </Pressable>
        </Screen>
    );
}

function InvalidChat(): React.ReactElement {
    return (
        <Screen style={styles.center}>
            <AppText variant="title">Invalid chat</AppText>
            <Pressable
                onPress={(): void => router.replace('/(app)')}
                style={styles.smallButtonGhost}
            >
                <Text style={styles.smallButtonGhostText}>Back to chats</Text>
            </Pressable>
        </Screen>
    );
}

const styles = StyleSheet.create({
    screen: { gap: spacing.xs, paddingHorizontal: spacing.sm },
    center: { alignItems: 'center', justifyContent: 'center' },
    headerBar: { marginBottom: spacing.xxs },
    selectionBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.sm,
        borderRadius: radii.lg,
        backgroundColor: palette.glass.elevated,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    selectionAction: { paddingHorizontal: spacing.xs, paddingVertical: 4 },
    selectionCancel: {
        color: palette.primary[700],
        fontSize: 14,
        fontWeight: '600',
    },
    selectionCount: {
        flex: 1,
        textAlign: 'center',
        color: palette.text.primary,
        fontSize: 14,
        fontWeight: '700',
    },
    selectionForward: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderRadius: radii.sm,
        backgroundColor: palette.primary[500],
    },
    selectionForwardDisabled: { backgroundColor: palette.neutral[300] },
    selectionForwardText: {
        color: palette.text.onAccent,
        fontSize: 13,
        fontWeight: '700',
    },
    headerIdentity: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    pressed: { opacity: 0.6 },
    headerMeta: { flex: 1 },
    avatar: { width: 44, height: 44, borderRadius: 22 },
    avatarFallback: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: palette.primary[100],
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarFallbackText: {
        color: palette.primary[700],
        fontSize: 18,
        fontWeight: '700',
    },
    backButton: { paddingHorizontal: spacing.xxs, paddingVertical: spacing.xs },
    backText: { color: palette.primary[600], fontSize: 26, fontWeight: '700' },
    pillButton: {
        borderWidth: 1,
        borderColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
    },
    pillText: { color: palette.primary[600], fontSize: 13, fontWeight: '600' },
    iconButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.full,
    },
    gearGlyph: {
        fontSize: 20,
        lineHeight: 24,
        color: palette.neutral[700],
    },
    chatArea: { flex: 1 },
    list: { flex: 1 },
    listContent: { paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
    daySlot: {},
    olderRow: {
        alignItems: 'center',
        paddingVertical: spacing.xs,
    },
    olderRetryText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
    jumpBanner: {
        position: 'absolute',
        top: spacing.xs,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        backgroundColor: palette.glass.elevated,
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    jumpBannerText: { color: palette.neutral[700], fontSize: 12 },
    jumpNotice: {
        color: palette.neutral[700],
        backgroundColor: palette.neutral[100],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        fontSize: 12,
        textAlign: 'center',
        marginBottom: spacing.xxs,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xxs,
        paddingHorizontal: spacing.lg,
    },
    emptyCaption: { textAlign: 'center' },
    sendError: { color: palette.semantic.danger, paddingBottom: spacing.xxs },
    // action sheet
    sheetBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
        paddingHorizontal: spacing.sm,
        paddingBottom: spacing.md,
    },
    sheetCard: {
        backgroundColor: palette.elevated,
        borderWidth: 1,
        borderColor: palette.border.subtle,
        borderRadius: radii.md,
        overflow: 'hidden',
    },
    quickReactions: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.neutral[100],
        paddingVertical: spacing.xs,
    },
    quickReactionsContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
    },
    quickReaction: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.neutral[50],
    },
    quickReactionSelected: {
        backgroundColor: palette.primary[100],
        borderWidth: 1,
        borderColor: palette.primary[500],
    },
    quickReactionEmoji: { fontSize: 22 },
    sheetButton: { padding: spacing.md },
    sheetActionText: {
        color: palette.primary[600],
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    sheetDeleteText: {
        color: palette.semantic.danger,
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    sheetCancelText: {
        color: palette.neutral[500],
        fontSize: 16,
        textAlign: 'center',
    },
    sheetDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: palette.neutral[100],
    },
    modalAvoid: { flex: 1, justifyContent: 'center' },
    smallButtonDisabled: { opacity: 0.4 },
    // modals
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    modalCard: {
        width: '100%',
        backgroundColor: palette.elevated,
        borderWidth: 1,
        borderColor: palette.border.subtle,
        borderRadius: radii.md,
        padding: spacing.md,
        gap: spacing.sm,
    },
    modalInput: {
        borderWidth: 1,
        borderColor: palette.border.subtle,
        borderRadius: radii.md,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        minHeight: 60,
        color: palette.text.primary,
        backgroundColor: palette.glass.elevated,
    },
    modalError: { color: palette.semantic.danger },
    modalActions: { flexDirection: 'row', gap: spacing.xs },
    // admin
    adminScreen: { gap: spacing.md, paddingHorizontal: spacing.lg },
    adminHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    section: { gap: spacing.xxs },
    sectionFlex: { flex: 1 },
    input: {
        borderWidth: 1,
        borderColor: palette.border.subtle,
        borderRadius: radii.md,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        color: palette.text.primary,
        backgroundColor: palette.glass.elevated,
    },
    smallButton: {
        alignSelf: 'flex-start',
        backgroundColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    smallButtonDanger: { backgroundColor: palette.semantic.danger },
    smallButtonText: {
        color: palette.text.onAccent,
        fontSize: 13,
        fontWeight: '600',
    },
    smallButtonGhost: {
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    smallButtonGhostText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
    feedback: { color: palette.neutral[500] },
    leaveError: { color: palette.semantic.danger },
    memberRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xxs,
        borderBottomWidth: 1,
        borderBottomColor: palette.neutral[100],
    },
    memberBody: { flex: 1 },
    bannedRow: {
        paddingVertical: spacing.xxs,
        borderBottomWidth: 1,
        borderBottomColor: palette.neutral[100],
    },
});
