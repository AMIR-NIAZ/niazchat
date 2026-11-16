import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    ActivityIndicator,
    AppState,
    BackHandler,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import type {
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
    StyleProp,
    ViewStyle,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import {
    AppText,
    GlassHeader,
    OfflineCaption,
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
import { EdgeFadeView, FADE_EXTRA } from '../../../shared/edge-fade';
import { useSocketConnectionState } from '../../../core/socket';
import type { ReactionUserDto } from '../../../core/api';
import {
    MUSIC_BAR_LIFT,
    consumeMusicJumpRequest,
    registerMusicJumpHandler,
    syncMusicQueue,
    useMiniPlayerAnchor,
    useMusicBarShown,
} from '../../../shared/music-player';
import type { MusicTrack } from '../../../shared/music-player';
import { evictAudioDownload } from '../../../shared/media-cache';
import { useAndroidKeyboardInset } from '../../../shared/hooks/use-android-keyboard-inset';
import {
    DateSeparator,
    ForwardPicker,
    MessageBubble,
    MessageBubblePreview,
    MessageComposer,
    MessageReactionsCard,
    ScrollToBottomButton,
    UnreadDivider,
    GroupChatSubtitle,
    useChatMessages,
    useMarkSeen,
    useScrollToBottomButton,
    chatListGeometry,
    useTypingEmitter,
    useTypingUsers,
    NO_MORE_SAVED_MESSAGES,
    assignMessageRuns,
    formatDaySeparator,
    firstUnreadMessageId,
    highestVisibleMessageId,
    pickReadTarget,
    buildMessageMenuItems,
    getBubbleAccessibilityActions,
    getMessageActions,
    reactionChoices,
    isForwardable,
    isOwnMessage,
    pruneForwardSelection,
    selectedMessageIds,
    toReplyPreview,
    toggleForwardSelection,
} from '../../../features/messages';
import type {
    ChatMessage,
    MessageMenuActionId,
} from '../../../features/messages';
import type { LocalAttachment } from '../../../features/attachments';
import type { ViewerRect } from '../../../features/attachments/viewer/viewer-model';
import {
    closeMediaViewer,
    deleteCachedAttachment,
    downloadAttachment,
    mimeForFileName,
    openMediaViewer,
    shareLocalFile,
} from '../../../features/attachments';
import {
    getChatDisplay,
    isGroupOwner,
    isPrivateChat,
    purgeChatFromCaches,
    setActiveChat,
    useLeaveChatRoomOnUnmount,
} from '../../../features/chats';
import type { ChatRole } from '../../../features/chats';
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
import { useReactionEmojis } from '../../../features/reactions';
import { useContextPopup } from '../../../shared/context-popup';
import { dialog, toast } from '../../../shared/dialog';
import type {
    ContextPopupConfig,
    PopupRect,
} from '../../../shared/context-popup';

/**
 * Conversation screen (chat list → tap → this screen).
 *
 * Implemented strictly from the documented backend surface:
 * - `joinChat` + `chatInfo` via WS (title/type/avatar/ban state).
 * - History via paginated `getMessages` (first page on join, older pages as the
 *   user scrolls up; the inverted list keeps the newest messages at the bottom).
 * - Live messaging over `sendMessage`/`sendMessage:list`,
 *   `editMessage`/`editMessage:list`, `deleteMessage`/`deleteMessage:list`.
 * - Group management lives in the group-settings screens (admin tools and
 *   banned users), reached from the group-info header.
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
/** Breathing room between the list content and the floating chrome. */
const LIST_GAP = 12;

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
    const keyboard = useAndroidKeyboardInset();
    const popup = useContextPopup();
    const window = useWindowDimensions();
    // Session-derived (access-token `sub`), numeric, and stable across profile
    // updates: a `['me']` refetch can never change or lose it.
    const currentUserId = useCurrentUserId();
    const socketState = useSocketConnectionState();
    const conversation = useChatMessages(chatId, true, currentUserId);
    // The mini player is global: it shows here (and only here or on the chat
    // list) while it sits BELOW the floating chat header, and the list clears
    // the extra strip.
    //
    // The screen subscribes to that ONE boolean only (a stable primitive): the
    // player's position/status churn must never re-render the chat screen or
    // its message rows.
    const musicBarShown = useMusicBarShown();
    const reactionEmojis = useReactionEmojis();
    const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
    const [actionDraft, setActionDraft] = useState('');
    const [actionError, setActionError] = useState<string | null>(null);
    const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [forwardOpen, setForwardOpen] = useState(false);
    const [unreadDividerId, setUnreadDividerId] = useState<number | null>(null);
    const [screenFocused, setScreenFocused] = useState(false);
    const [appActive, setAppActive] = useState(
        AppState.currentState === 'active',
    );
    // Measured chrome, so the full-screen list can reserve exactly the space
    // the floating header/composer cover (never magic numbers).
    const [headerHeight, setHeaderHeight] = useState(0);
    const [composerHeight, setComposerHeight] = useState(0);
    const [noticesHeight, setNoticesHeight] = useState(0);
    /** Measured list viewport: the chrome may never reserve more than half. */
    const [listHeight, setListHeight] = useState(0);
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);

    useEffect((): (() => void) => {
        const show = Keyboard.addListener('keyboardDidShow', (event): void => {
            setKeyboardHeight(Math.round(event.endCoordinates.height));
            setKeyboardVisible(true);
        });
        const hide = Keyboard.addListener('keyboardDidHide', (): void => {
            setKeyboardHeight(0);
            setKeyboardVisible(false);
        });
        return (): void => {
            show.remove();
            hide.remove();
        };
    }, []);

    const measureHeader = useCallback((event: LayoutChangeEvent): void => {
        const height = Math.round(event.nativeEvent.layout.height);
        setHeaderHeight((current) => (current === height ? current : height));
    }, []);
    // This screen owns the mini bar's top edge: while it is focused and its
    // header layer is measured, it registers `headerHeight + gap` and unregisters
    // on blur. The list clears the same strip (visual bottom of the inverted
    // list is the composer side, so the bar grows `paddingBottom`).
    useMiniPlayerAnchor(headerHeight > 0 ? headerHeight : null);
    const measureNotices = useCallback((event: LayoutChangeEvent): void => {
        const height = Math.round(event.nativeEvent.layout.height);
        setNoticesHeight((current) => (current === height ? current : height));
    }, []);
    const measureComposer = useCallback((height: number): void => {
        setComposerHeight((current) => (current === height ? current : height));
    }, []);

    const detail = conversation.detail;
    const messages = detail?.messages ?? [];
    const info = detail?.info ?? null;
    // Server `type` is the single source of truth; unknown/missing = group.
    const isPrivate = info !== null && isPrivateChat(info);
    const isGroup = !isPrivate;
    // The gear is rendered only after the server says the caller is owner or
    // admin (group info is fetched once per group chat, hidden while unknown).
    const groupInfoQuery = useGroupInfo(isGroup && info !== null ? chatId : 0);
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

    /** This chat's playable tracks in ASCENDING order (the player's queue). */
    const musicQueue = useMemo<MusicTrack[]>(() => {
        const ordered = [...messages].sort((a, b) => {
            const byTime = a.createdAtIso.localeCompare(b.createdAtIso);
            if (byTime !== 0) return byTime;
            return (
                (a.id ?? Number.MAX_SAFE_INTEGER) -
                (b.id ?? Number.MAX_SAFE_INTEGER)
            );
        });
        const tracks: MusicTrack[] = [];
        for (const message of ordered) {
            for (const attachment of message.attachments) {
                if (attachment.kind !== 'music' || attachment.id === null) {
                    continue;
                }
                tracks.push({
                    attachmentId: attachment.id,
                    messageKey: message.key,
                    chatId,
                    title: attachment.title ?? attachment.name,
                    artist: attachment.artist ?? null,
                    coverUrl: attachment.coverUrl ?? null,
                    localUri: attachment.localUri ?? null,
                    mimeType: attachment.mimeType,
                    name: attachment.name,
                    size: attachment.size,
                    durationSeconds: attachment.durationSeconds ?? null,
                });
            }
        }
        return tracks;
    }, [chatId, messages]);

    // Live queue: appends and deletions update the player without touching
    // playback (the store ignores this while another chat is playing).
    useEffect((): void => {
        syncMusicQueue(chatId, musicQueue);
    }, [chatId, musicQueue]);

    const listRef = useRef<FlatList<List>>(null);
    const atBottomRef = useRef(true);
    const initialScrollDoneRef = useRef(false);
    /** True while the user's finger/momentum owns the list. */
    const userScrollingRef = useRef(false);
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
        userScrollingRef.current = false;
        lastNewestIdRef.current = null;
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
    // Blurring the chat closes the menu: the anchor no longer exists.
    const popupCloseRef = useRef(popup.close);
    popupCloseRef.current = popup.close;
    useFocusEffect(
        useCallback((): (() => void) => {
            setScreenFocused(true);
            ensureActiveRef.current();
            return (): void => {
                setScreenFocused(false);
                popupCloseRef.current();
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

    // Leaving the screen (or switching chats) never leaves a menu — or the
    // full-screen media viewer, which is mounted above the whole app — behind.
    useEffect((): (() => void) => {
        return (): void => {
            popup.close();
            closeMediaViewer();
        };
    }, [popup, chatId]);

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

    // Auto-scroll runs ONLY when the newest CONFIRMED id actually advances:
    //   (a) once when the chat opens (previous id null → instant, invisible),
    //   (b) when a new message arrives while the user sits at the live edge.
    // Re-merges of the same page, edits, reactions, pagination of older pages,
    // image/music layout and padding changes all keep the same newest id, so
    // they can never move the list. A drag in progress is never overridden.
    //
    // The same effect feeds the button badge: a newest id that jumps forward
    // (a live message, never an older `loadOlder` page) from another member
    // while scrolled up counts once. Own and pending/failed messages have no
    // confirmed id newer than the previous newest, so they never count.
    useEffect((): void => {
        const newestId = newestConfirmedId;
        if (newestId === null) {
            return;
        }
        const previousId = lastNewestIdRef.current;
        lastNewestIdRef.current = newestId;
        const newest = messages[messages.length - 1];
        const liveFromOther =
            newest !== undefined &&
            newest.id === newestId &&
            newest.status === 'sent' &&
            previousId !== null &&
            newestId > previousId &&
            !isOwnMessage(currentUserId, newest.senderId);
        if (liveFromOther && !atBottomRef.current) {
            newMessageCountRef.current = Math.min(
                newMessageCountRef.current + 1,
                999,
            );
            setNewMessageCount(newMessageCountRef.current);
        }
        if (newestId === previousId) {
            return;
        }
        if (
            jumpInProgressRef.current ||
            userScrollingRef.current ||
            !atBottomRef.current
        ) {
            return;
        }
        listRef.current?.scrollToOffset({
            offset: 0,
            animated: previousId !== null,
        });
    }, [newestConfirmedId, messages, currentUserId]);

    // The keyboard opening/closing resizes the list frame. While the user is at
    // the live edge they must stay there: re-anchor on the newest row (offset 0
    // on an inverted list) once the new frame has laid out, so the latest
    // message always ends up just above the composer. Scrolled-up users keep
    // their own offset untouched, and a drag in progress is never overridden.
    const keyboardAnchorReadyRef = useRef(false);
    useEffect((): (() => void) | undefined => {
        if (!keyboardAnchorReadyRef.current) {
            keyboardAnchorReadyRef.current = true;
            return undefined;
        }
        const frame = requestAnimationFrame((): void => {
            if (atBottomRef.current && !userScrollingRef.current) {
                listRef.current?.scrollToOffset({
                    offset: 0,
                    animated: false,
                });
            }
        });
        return (): void => cancelAnimationFrame(frame);
    }, [keyboardVisible, keyboardHeight]);

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

    // "Go to message" from the full player: jump to the track's bubble. The
    // handler lives in a ref so the registration survives message updates.
    const musicJumpRef = useRef<(messageKey: string) => void>(() => undefined);
    musicJumpRef.current = (messageKey: string): void => {
        const target = messages.find((message) => message.key === messageKey);
        if (target?.id !== null && target?.id !== undefined) {
            performJump(target.id);
            return;
        }
        showJumpNotice('This message is no longer available');
    };
    useEffect(
        (): (() => void) =>
            registerMusicJumpHandler(chatId, (messageKey): void => {
                musicJumpRef.current(messageKey);
            }),
        [chatId],
    );
    // A request left while another chat was open is consumed once this chat
    // has its messages (the player navigated here).
    useEffect((): void => {
        if (messages.length === 0) return;
        const messageKey = consumeMusicJumpRequest(chatId);
        if (messageKey !== null) {
            musicJumpRef.current(messageKey);
        }
    }, [chatId, messages.length]);

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
        popup.close();
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
        popup.close();
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

    /// Floating message popups -------------------------------------------------

    const startEditing = (target: ChatMessage): void => {
        setActionTarget(target);
        setActionDraft(target.content ?? '');
        setActionError(null);
    };

    const shareMessageFile = (target: ChatMessage): void => {
        const document = target.attachments.find(
            (attachment) =>
                attachment.kind === 'file' && attachment.id !== null,
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
                    mimeForFileName(document.name, document.mimeType),
                    document.name,
                ),
            )
            .catch((error: unknown) =>
                dialog.show({
                    title: 'Could not share file',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Share failed.',
                    tone: 'danger',
                }),
            );
    };

    const deleteMessage = (target: ChatMessage): void => {
        if (target.id === null || conversation.mutating) {
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
        void dialog
            .confirm({
                title: deletingOtherMember
                    ? 'Delete for everyone?'
                    : 'Delete message?',
                message: explanation,
                confirmText: 'Delete',
                destructive: true,
            })
            .then((confirmed): void => {
                if (!confirmed) {
                    return;
                }
                const messageId = target.id;
                if (messageId === null) {
                    return;
                }
                if (
                    target.attachments.some(
                        (attachment) =>
                            attachment.id !== null &&
                            attachment.id === getVoicePlayback().attachmentId,
                    )
                ) {
                    stopVoice();
                }
                // Music: deleting the playing track does not stop playback —
                // the live queue sync skips to the next track in the order.
                for (const attachment of target.attachments) {
                    if (attachment.kind === 'music' && attachment.id !== null) {
                        evictAudioDownload(attachment.id);
                    }
                }
                void conversation
                    .remove(messageId)
                    .then((): void => {
                        for (const attachment of target.attachments) {
                            if (attachment.id === null) {
                                continue;
                            }
                            void deleteCachedAttachment(attachment.id);
                            if (attachment.kind === 'voice') {
                                const path = voiceCachePath(
                                    attachment.id,
                                    attachment.mimeType,
                                );
                                if (path !== null) {
                                    void deleteVoiceFile(path);
                                }
                            }
                        }
                    })
                    .catch((error: unknown) =>
                        dialog.show({
                            title: 'Could not delete message',
                            message:
                                error instanceof Error
                                    ? error.message
                                    : 'Delete failed.',
                            tone: 'danger',
                        }),
                    );
            });
    };

    const performMessageAction = (
        target: ChatMessage,
        action: MessageMenuActionId,
    ): void => {
        switch (action) {
            case 'reply':
                if (target.status === 'sent') {
                    setReplyTarget(target);
                }
                return;
            case 'forward':
                handleOpenForward(target);
                return;
            case 'copy':
                // Always the FULL text, never the popup copy.
                void Clipboard.setStringAsync(target.content ?? '');
                return;
            case 'select':
                beginSelection(target);
                return;
            case 'share':
                shareMessageFile(target);
                return;
            case 'edit':
                startEditing(target);
                return;
            case 'delete':
                deleteMessage(target);
                return;
        }
    };

    /**
     * The popup's whole content, computed synchronously at press time. Every
     * action runs only after the popup is gone; the host owns that sequencing.
     */
    const buildMessageMenuConfig = (
        message: ChatMessage,
        anchor: PopupRect,
        options: { showPreview?: boolean | undefined } = {},
    ): ContextPopupConfig => {
        const mineMessage = isOwnMessage(currentUserId, message.senderId);
        const actions = getMessageActions(message, {
            currentUserId,
            canDeleteOthers: isGroup && isOwner,
        });
        const items = buildMessageMenuItems(actions, {
            onReply: (): void => performMessageAction(message, 'reply'),
            onForward: (): void => performMessageAction(message, 'forward'),
            onCopy: (): void => performMessageAction(message, 'copy'),
            onSelect: (): void => performMessageAction(message, 'select'),
            onShare: (): void => performMessageAction(message, 'share'),
            onEdit: (): void => performMessageAction(message, 'edit'),
            onDelete: (): void => performMessageAction(message, 'delete'),
        });
        const messageId = message.id;
        const canReact =
            message.status === 'sent' &&
            messageId !== null &&
            !message.isDeleted;
        const reactions = canReact
            ? reactionChoices(reactionEmojis, message.myReaction).map(
                  (choice) => ({
                      ...choice,
                      onPress: (): void => {
                          void conversation.toggleReaction(
                              messageId,
                              choice.emoji,
                          );
                      },
                  }),
              )
            : undefined;
        const showPreview = options.showPreview !== false;
        return {
            anchor,
            align: mineMessage ? 'end' : 'start',
            sourceKey: message.key,
            actions: items,
            ...(reactions === undefined ? {} : { reactions }),
            ...(showPreview
                ? {
                      preview: (
                          <MessageBubblePreview
                              message={message}
                              mine={mineMessage}
                              isGroup={isGroup}
                              currentUserId={currentUserId}
                              showSenderName={isGroup && !mineMessage}
                              showAvatar={false}
                              width={anchor.width}
                              height={anchor.height}
                          />
                      ),
                  }
                : {}),
            accessibilityLabel: 'Message actions',
        };
    };

    // Opens the app-wide full-screen viewer (mounted at the root, above this
    // screen's header and composer). Only a snapshot of the conversation is
    // handed over, so nothing here re-renders when it opens or closes.
    const openMedia = (
        source: ChatMessage,
        mediaIndex: number,
        origin: ViewerRect | null,
    ): void => {
        openMediaViewer({
            messages,
            initialMessageKey: source.key,
            initialIndex: mediaIndex,
            origin,
            onForward: handleOpenForward,
            onGoToMessage: (message): void => {
                if (message.id !== null) {
                    performJump(message.id);
                }
            },
            onDelete: deleteMessage,
            canDelete: (message): boolean =>
                getMessageActions(message, {
                    currentUserId,
                    canDeleteOthers: isGroup && isOwner,
                }).delete === true,
        });
    };

    const openMessageMenu = (message: ChatMessage, anchor: PopupRect): void => {
        if (message.status !== 'sent' || message.id === null) {
            return;
        }
        popup.open(buildMessageMenuConfig(message, anchor));
    };

    const handleOpenReactor = (user: ReactionUserDto): void => {
        // Close first, navigate afterwards: the overlay must be gone before the
        // profile screen mounts.
        popup.close((): void => {
            openUserProfile({
                userId: user.userId,
                name: user.name,
                avatar: user.avatars[0] ?? null,
                isSelf:
                    currentUserId !== null &&
                    Number(user.userId) === Number(currentUserId),
            });
        });
    };

    const openReactionsList = (message: ChatMessage): void => {
        if (message.id === null) return;
        popup.open({
            anchor: { x: 0, y: 0, width: 1, height: 1 },
            sourceKey: message.key,
            center: {
                width: Math.min(window.width - spacing.lg, 360),
                height: Math.round(window.height * 0.6),
                content: (
                    <MessageReactionsCard
                        chatId={chatId}
                        message={message}
                        currentUserId={currentUserId}
                        onOpenUser={handleOpenReactor}
                    />
                ),
            },
            accessibilityLabel: 'Reactions',
        });
    };

    const accessibilityActionsFor = (
        message: ChatMessage,
    ): { name: string; label: string }[] => {
        const actions = getMessageActions(message, {
            currentUserId,
            canDeleteOthers: isGroup && isOwner,
        });
        return getBubbleAccessibilityActions(
            actions,
            message.status === 'sent' &&
                message.id !== null &&
                !message.isDeleted,
        );
    };

    const handleBubbleAccessibilityAction = (
        message: ChatMessage,
        name: string,
    ): void => {
        if (name === 'react') {
            // No touch anchor available: open the menu in the middle of the
            // screen without a lifted copy so the emoji row is reachable.
            const anchor: PopupRect = {
                x: Math.max(0, Math.round(window.width / 2) - 2),
                y: Math.max(0, Math.round(window.height / 2) - 2),
                width: 4,
                height: 4,
            };
            popup.open(
                buildMessageMenuConfig(message, anchor, {
                    showPreview: false,
                }),
            );
            return;
        }
        if (
            name === 'reply' ||
            name === 'forward' ||
            name === 'edit' ||
            name === 'delete'
        ) {
            performMessageAction(message, name);
        }
    };

    const handleListLayout = useCallback(
        (event: LayoutChangeEvent): void => {
            const height = Math.round(event.nativeEvent.layout.height);
            setListHeight((current) => (current === height ? current : height));
            scrollToLatestButton.onLayout(event);
        },
        [scrollToLatestButton.onLayout],
    );

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
          : info?.peer != null
            ? presenceLabel({
                  isOnline: info.peer.isOnline,
                  lastSeen: info.peer.lastSeen,
              })
            : null;

    /** Removed by an owner/admin while this chat (or the group panel) is open. */
    const handleRemovedFromGroup = useCallback((): void => {
        purgeChatFromCaches(queryClient, chatId);
        toast.show('You were removed from this group');
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

    // ── Stable FlatList identity ────────────────────────────────────────────
    // FlatList re-renders every visible cell when `renderItem`, `keyExtractor`
    // or `extraData` changes identity. These are therefore created once (or
    // memoized on their real inputs) and the row renderer is read through a
    // ref, so unrelated re-renders never touch the message rows.
    const rowRendererRef = useRef<(info: { item: List }) => React.ReactElement>(
        () => null as unknown as React.ReactElement,
    );
    const renderItem = useCallback(
        (info: { item: List }): React.ReactElement =>
            rowRendererRef.current(info),
        [],
    );
    const keyExtractor = useCallback(
        (chunk: List): string =>
            chunk.kind === 'message'
                ? `m-${chunk.message.key}`
                : chunk.kind === 'unread'
                  ? `u-${chunk.key}`
                  : `d-${chunk.key}`,
        [],
    );
    const listExtraData = useMemo(
        (): string => `${selecting}:${[...selectedIds].join(',')}`,
        [selecting, selectedIds],
    );

    // ── Full-screen list geometry ────────────────────────────────────────────
    // The header and the composer float over the list, so the list only needs
    // to keep its content clear of them:
    //   · `headerHeight`    = measured header layer (safe-area top + pill)
    //   · `bottomMargin`    = where the composer layer is anchored above the
    //     window bottom, i.e. the part of the composer stack that is inside the
    //     list frame
    //   · `composerBottom`  = the same anchor plus the Android keyboard inset,
    //     which only positions the composer layer (the list frame is already
    //     shortened by that inset)
    //
    // `chatListGeometry` derives the padding/fade values from the OVERLAP of
    // the composer stack with the list frame. The keyboard moves the composer
    // up and shortens the frame by the same amount, so the overlap — and every
    // value below — stays identical whether the keyboard is open or closed.
    // Counting the keyboard a second time here is what used to make the padding
    // fill the whole frame (and the fade mask every message out) when the IME
    // opened.
    const bottomMargin = Math.max(insets.bottom, spacing.xs);
    const composerBottom = bottomMargin + (keyboard.open ? keyboard.inset : 0);
    const geometry = chatListGeometry({
        headerHeight,
        composerHeight,
        noticesHeight,
        bottomMargin,
        musicBarStrip: musicBarShown ? MUSIC_BAR_LIFT : 0,
        fadeExtra: FADE_EXTRA,
        gap: LIST_GAP,
        listHeight,
    });
    /** `geometry.headerStrip` is the VISUAL top edge (header + mini bar). */
    const listPaddingTop = geometry.listPaddingTop;
    /** Inverse: paddingBottom is the VISUAL top (header/mini-bar side). While
     * the mini bar shows, that strip grows by exactly the bar's lift — as ONE
     * discrete, rounded value, never per animation frame (the bar animates
     * with transforms/opacity in its own layer). It sits on the far end of an
     * inverted list, so the change cannot move the visible content and needs
     * no scroll-offset compensation. */
    const listPaddingBottom = geometry.listPaddingBottom;
    const topFade = geometry.topFade;
    const bottomFade = geometry.bottomFade;
    // Memoized style object: same identity until a measured value really
    // changes, so FlatList is never asked to re-measure the content because of
    // an unrelated render.
    const listContentStyle = useMemo(
        (): StyleProp<ViewStyle> => [
            styles.listContent,
            {
                paddingTop: listPaddingTop,
                paddingBottom: listPaddingBottom,
            },
        ],
        [listPaddingTop, listPaddingBottom],
    );
    // Native scrollbar stays between the header/bar strip and the composer.
    const indicatorInsets = useMemo(
        (): { top: number; bottom: number } => ({
            top: geometry.indicatorTop,
            bottom: geometry.indicatorBottom,
        }),
        [geometry.indicatorTop, geometry.indicatorBottom],
    );
    const hasNotices =
        conversation.sendError !== null ||
        conversation.reactionError !== null ||
        jumpNotice !== null ||
        socketState === 'disconnected';
    // The scroll-to-latest button lives in the full-screen list layer, so its
    // bottom offset is measured from the window edge: on iOS the list frame is
    // lifted by the keyboard while the layer is not, on Android the resized
    // window already moves that edge.
    const scrollButtonBottom =
        (Platform.OS === 'ios' && keyboardVisible
            ? keyboardHeight
            : composerBottom) +
        composerHeight +
        noticesHeight +
        spacing.sm;

    // Without a session user id nothing can be classified as mine: wait for it
    // instead of rendering every bubble on the wrong side. This is session
    // state (not the profile query), so a profile/me refetch never returns here.
    // Cached data always wins: a pending/failed refetch must never replace a
    // rendered conversation with a loader or an error screen.
    if ((conversation.isLoading && detail === null) || currentUserId === null) {
        return <LoadingBlock />;
    }
    if (detail === null) {
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
                        suffix={info?.isBan === true ? ' · banned' : ''}
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

    // Row renderer kept OUT of the list props: it is read through a ref by a
    // permanently stable `renderItem`, so a re-render of this screen can
    // never hand FlatList a new renderer (that re-renders every visible row).
    const renderRow = ({ item }: { item: List }): React.ReactElement => {
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
        const mine = isOwnMessage(currentUserId, message.senderId);
        return (
            <MessageBubble
                message={message}
                mine={mine}
                isGroup={isGroup}
                musicQueue={musicQueue}
                currentUserId={currentUserId}
                showSenderName={item.showSenderName}
                showAvatar={item.showAvatar}
                onOpenLink={selecting ? undefined : handleOpenLink}
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
                onForwardedProfilePress={(userId, forwardedName): void => {
                    openUserProfile({
                        userId,
                        name: forwardedName,
                        isSelf: isOwnMessage(currentUserId, userId),
                    });
                }}
                selectionMode={selecting}
                selected={message.id !== null && selectedIds.has(message.id)}
                onToggleSelect={handleToggleSelection}
                highlighted={highlightedKey === message.key}
                othersLastSeenId={detail?.othersLastSeenId ?? null}
                // Tap or hold on the bubble opens the
                // floating menu; pending/failed bubbles
                // keep their own retry/cancel actions.
                onOpenMenu={selecting ? undefined : openMessageMenu}
                accessibilityActions={
                    selecting ? undefined : accessibilityActionsFor(message)
                }
                onAccessibilityAction={
                    selecting
                        ? undefined
                        : (name): void =>
                              handleBubbleAccessibilityAction(message, name)
                }
                onReplyPress={selecting ? undefined : handleReplyPress}
                onRetryFailed={
                    selecting
                        ? undefined
                        : (failed): void => conversation.retrySend(failed.key)
                }
                onRetryPending={
                    selecting
                        ? undefined
                        : (pending): void => conversation.retrySend(pending.key)
                }
                onCancelPending={
                    selecting
                        ? undefined
                        : (pending): void =>
                              conversation.cancelSend(pending.key)
                }
                onRemovePending={
                    selecting
                        ? undefined
                        : (pending): void =>
                              conversation.cancelSend(pending.key)
                }
                onOpenMedia={selecting ? undefined : openMedia}
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
                onOpenReactions={selecting ? undefined : openReactionsList}
            />
        );
    };
    rowRendererRef.current = renderRow;

    return (
        <Screen
            style={styles.screen}
            // The container spans the window: its measured bottom edge tells
            // the keyboard hook whether Android already resized it.
            onLayout={keyboard.onContainerLayout}
            withTopInset={false}
            withBottomInset={false}
        >
            <View
                pointerEvents="box-none"
                style={[
                    styles.headerLayer,
                    {
                        paddingTop: insets.top + spacing.md,
                        paddingHorizontal: spacing.sm,
                    },
                ]}
                onLayout={measureHeader}
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
                            <Text style={styles.selectionForwardText}>
                                Forward
                            </Text>
                        </Pressable>
                    </View>
                ) : (
                    <GlassHeader layout="row">
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
                    </GlassHeader>
                )}
            </View>

            <View
                pointerEvents="box-none"
                style={[
                    styles.listLayer,
                    keyboard.open &&
                        keyboard.inset > 0 && { paddingBottom: keyboard.inset },
                ]}
            >
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
                        // The list now spans the window, so there is no offset to
                        // compensate for: the padding is exactly the overlap.
                        keyboardVerticalOffset={0}
                    >
                        {/* Soft edge fade at both ends. MaskedView (not overlay
                        gradients) because the Screen background is painted
                        with ambient shapes that must show through the fade. */}
                        <EdgeFadeView
                            style={styles.list}
                            topFade={topFade}
                            bottomFade={bottomFade}
                        >
                            <FlatList
                                ref={listRef}
                                inverted={true}
                                style={styles.list}
                                contentContainerStyle={listContentStyle}
                                scrollIndicatorInsets={indicatorInsets}
                                keyExtractor={keyExtractor}
                                keyboardShouldPersistTaps="handled"
                                // Scrolling or tapping the list never closes the
                                // keyboard: only the system back gesture (or an
                                // explicit action) does.
                                keyboardDismissMode="none"
                                onScrollBeginDrag={(): void => {
                                    userScrollingRef.current = true;
                                    cancelJump();
                                    scrollToLatestButton.cancelScrollToBottom();
                                }}
                                // The user owns the list until the gesture (and
                                // its momentum) is over; auto-scroll stays out.
                                onScrollEndDrag={(): void => {
                                    userScrollingRef.current = false;
                                }}
                                onMomentumScrollBegin={(): void => {
                                    userScrollingRef.current = true;
                                }}
                                onMomentumScrollEnd={(): void => {
                                    userScrollingRef.current = false;
                                }}
                                onScroll={handleListScroll}
                                onViewableItemsChanged={onViewableItemsChanged}
                                viewabilityConfig={viewabilityConfig}
                                onLayout={handleListLayout}
                                onContentSizeChange={
                                    scrollToLatestButton.onContentSizeChange
                                }
                                scrollEventThrottle={16}
                                // Inverted: the visual top is the END of the data, so
                                // this fires when the user nears the oldest message.
                                onEndReached={(): void =>
                                    conversation.loadOlder()
                                }
                                onEndReachedThreshold={0.4}
                                onScrollToIndexFailed={(info): void => {
                                    // Variable row heights: jump approximately, then
                                    // retry the exact target once rows are measured.
                                    listRef.current?.scrollToOffset({
                                        offset:
                                            info.averageItemLength * info.index,
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
                                    <>
                                        {conversation.loadingOlder ? (
                                            <View style={styles.olderRow}>
                                                <ActivityIndicator
                                                    size="small"
                                                    color={palette.primary[500]}
                                                />
                                            </View>
                                        ) : conversation.loadOlderError ===
                                          NO_MORE_SAVED_MESSAGES ? (
                                            <View style={styles.olderRow}>
                                                <Text
                                                    style={
                                                        styles.olderRetryText
                                                    }
                                                >
                                                    No more saved messages
                                                </Text>
                                            </View>
                                        ) : conversation.loadOlderError !==
                                          null ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel="Retry loading older messages"
                                                style={styles.olderRow}
                                                onPress={(): void =>
                                                    conversation.loadOlder()
                                                }
                                            >
                                                <Text
                                                    style={
                                                        styles.olderRetryText
                                                    }
                                                >
                                                    Couldn&apos;t load older
                                                    messages · Retry
                                                </Text>
                                            </Pressable>
                                        ) : undefined}
                                    </>
                                }
                                data={reversedListData}
                                extraData={listExtraData}
                                renderItem={renderItem}
                            />
                        </EdgeFadeView>
                        {jumpLoadingId !== null && (
                            <View
                                style={[
                                    styles.jumpBanner,
                                    { top: headerHeight + spacing.xs },
                                ]}
                                pointerEvents="none"
                            >
                                <ActivityIndicator
                                    size="small"
                                    color={palette.primary[500]}
                                />
                                <Text style={styles.jumpBannerText}>
                                    Looking for the message…
                                </Text>
                            </View>
                        )}
                    </KeyboardAvoidingView>
                )}
                <ScrollToBottomButton
                    visible={scrollToLatestButton.visible}
                    count={newMessageCount}
                    bottomOffset={scrollButtonBottom}
                    onPress={handleScrollToLatest}
                />
            </View>

            {/* Floating composer: anchored above the keyboard; its measured
                content height drives the list padding above. */}
            <View
                pointerEvents="box-none"
                style={[styles.composerLayer, { bottom: composerBottom }]}
            >
                {hasNotices && (
                    <View
                        pointerEvents="none"
                        style={styles.notices}
                        onLayout={measureNotices}
                    >
                        <OfflineCaption />
                        {conversation.sendError !== null && (
                            <Text style={styles.sendError}>
                                {conversation.sendError}
                            </Text>
                        )}
                        {conversation.reactionError !== null && (
                            <Text style={styles.sendError}>
                                {conversation.reactionError}
                            </Text>
                        )}
                        {jumpNotice !== null && (
                            <Text style={styles.jumpNotice}>{jumpNotice}</Text>
                        )}
                    </View>
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
                    onHeightChange={measureComposer}
                />
            </View>

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
        </Screen>
    );
}

type List = ListChunk;

/** Minimal viewability token (RN no longer exports `ViewToken`). */
interface ChatViewToken {
    item?: List | undefined;
}

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
    screen: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center' },
    // ── Full-screen list + floating chrome ──────────────────────────────────
    // The list paints nothing: the Screen's canvas and ambient glows show
    // through, including in the faded strips where the chrome overlaps it.
    listLayer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
    },
    headerLayer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2,
    },
    composerLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        paddingHorizontal: spacing.sm,
        zIndex: 3,
    },
    notices: {
        alignItems: 'center',
        gap: spacing.xxs,
        paddingBottom: spacing.xxs,
    },
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
    // Only the horizontal gutter is fixed; the vertical padding is measured
    // from the floating header/composer and applied per render.
    listContent: { paddingHorizontal: spacing.xs },
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
    smallButtonDisabled: { opacity: 0.4 },
    modalAvoid: { flex: 1, justifyContent: 'center' },
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
});
