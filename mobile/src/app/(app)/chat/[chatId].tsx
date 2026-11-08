import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    ActivityIndicator,
    Alert,
    AppState,
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
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    AppText,
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
import { ApiError } from '../../../core/api';
import { useAndroidKeyboardInset } from '../../../shared/hooks/use-android-keyboard-inset';
import {
    DateSeparator,
    MessageBubble,
    MessageComposer,
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
    isOwnMessage,
    toReplyPreview,
} from '../../../features/messages';
import type { ChatMessage } from '../../../features/messages';
import {
    isGroupOwner,
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
import { openUserProfile } from '../../../features/users';

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
 * group rename, read receipts per user, reactions (broken server-side).
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
    const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
    const [actionDraft, setActionDraft] = useState('');
    const [actionError, setActionError] = useState<string | null>(null);
    const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
    const [unreadDividerId, setUnreadDividerId] = useState<number | null>(null);
    const dividerInitRef = useRef(false);
    const [screenFocused, setScreenFocused] = useState(false);
    const [appActive, setAppActive] = useState(
        AppState.currentState === 'active',
    );

    const detail = conversation.detail;
    const messages = detail?.messages ?? [];
    const info = detail?.info ?? null;
    const isGroup = info?.type !== undefined && info.type !== 'private';
    const typing = useTypingEmitter(chatId, isGroup);
    const typingUsers = useTypingUsers(chatId, isGroup, currentUserId);
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

    // A new chat starts with no reply, no divider and no initial-scroll state.
    useEffect((): void => {
        setReplyTarget(null);
        setUnreadDividerId(null);
        dividerInitRef.current = false;
        initialScrollDoneRef.current = false;
    }, [chatId]);

    // Focus/foreground drive "actually looking at this chat" for markSeen.
    useFocusEffect(
        useCallback((): (() => void) => {
            setScreenFocused(true);
            return (): void => setScreenFocused(false);
        }, []),
    );
    useEffect((): (() => void) => {
        const subscription = AppState.addEventListener(
            'change',
            (state): void => setAppActive(state === 'active'),
        );
        return (): void => subscription.remove();
    }, []);

    // Snapshot where the unread block starts, once per opening. Later
    // markSeen calls advance the read position but must not hide the divider.
    useEffect((): void => {
        if (
            dividerInitRef.current ||
            detail === null ||
            messages.length === 0
        ) {
            return;
        }
        dividerInitRef.current = true;
        const myId = currentUserId ?? -1;
        const firstUnread = messages.find(
            (message) =>
                message.id !== null &&
                message.senderId !== myId &&
                (detail.myLastSeenId === null ||
                    message.id > detail.myLastSeenId),
        );
        if (firstUnread?.id !== undefined && firstUnread?.id !== null) {
            setUnreadDividerId(firstUnread.id);
            // Opening on the divider is not "at the bottom": no markSeen yet.
            atBottomRef.current = false;
            setAtBottom(false);
        }
    }, [detail, messages, currentUserId]);

    useEffect((): (() => void) => {
        return (): void => {
            jumpAbortRef.current?.abort();
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

    // Focus + foreground + newest-visible is the only state that reads.
    const readingNow = screenFocused && appActive && atBottom;
    useMarkSeen(chatId, newestConfirmedId, readingNow);
    useEffect((): void => {
        setActiveChat(chatId, readingNow);
    }, [chatId, readingNow]);
    useEffect((): (() => void) => {
        return (): void => setActiveChat(null, false);
    }, [chatId]);

    // First load: land on the unread divider when one exists, else keep the
    // inverted default (newest at the bottom).
    useEffect((): void => {
        if (
            initialScrollDoneRef.current ||
            detail === null ||
            messages.length === 0
        ) {
            return;
        }
        initialScrollDoneRef.current = true;
        if (unreadDividerId === null) {
            return;
        }
        const index = reversedListData.findIndex(
            (item) => item.kind === 'unread',
        );
        if (index < 0) {
            return;
        }
        setTimeout((): void => {
            listRef.current?.scrollToIndex({
                index,
                viewPosition: 0.5,
                animated: false,
            });
        }, 50);
    }, [detail, messages.length, unreadDividerId, reversedListData]);

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

    const handleSend = (content: string): void => {
        typing.stopTyping();
        if (replyPreview !== null) {
            conversation.send(content, replyPreview);
        } else {
            conversation.send(content);
        }
        setReplyTarget(null);
        scrollToBottom();
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
     * Private chats have no server-side title; fall back to the peer's display
     * name from history senders (no user directory for PV chats exists).
     */
    const peer = isGroup
        ? null
        : (messages.find(
              (message) => !isOwnMessage(currentUserId, message.senderId),
          ) ?? null);
    const name =
        info?.title !== undefined && info.title !== null
            ? info.title
            : (peer?.senderName ??
              (isGroup ? 'Unnamed group' : 'Private chat'));
    // Server-relative path (group photo or the peer's current photo) so the
    // header asks for a thumbnail rather than the original file.
    const avatarPath =
        info?.avatars !== undefined && info.avatars.length > 0
            ? (info.avatars[0] ?? null)
            : (peer?.senderAvatarPath ?? peer?.senderAvatarUrls[0] ?? null);
    const headerAvatarUserId = isGroup ? chatId : (peer?.senderId ?? chatId);
    /** Private-chat peer is the only person a header tap may open. */
    const peerUserId = isGroup ? null : (peer?.senderId ?? null);

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
                    <AppText variant="caption">
                        Private{info.isBan ? ' · banned' : ''}
                    </AppText>
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
            <View style={styles.header}>
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
                ) : (
                    headerIdentity
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open chat admin panel"
                    style={styles.pillButton}
                    onPress={(): void => setAdminPanelOpen(true)}
                >
                    <Text style={styles.pillText}>Admin</Text>
                </Pressable>
            </View>

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
                                    onOpenProfile={(sender): void => {
                                        openUserProfile({
                                            userId: sender.senderId,
                                            name: sender.senderName,
                                            avatar: sender.senderAvatarPath,
                                        });
                                    }}
                                    highlighted={highlightedKey === message.key}
                                    othersLastSeenId={
                                        detail?.othersLastSeenId ?? null
                                    }
                                    // Any confirmed message can be replied to;
                                    // pending/failed bubbles cannot.
                                    onLongPress={
                                        message.status === 'sent' &&
                                        message.id !== null
                                            ? (): void =>
                                                  setSheetTarget(message)
                                            : undefined
                                    }
                                    onReplyPress={handleReplyPress}
                                    onRetryFailed={(failed): void =>
                                        conversation.retrySend(failed.key)
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

            {jumpNotice !== null && (
                <Text style={styles.jumpNotice}>{jumpNotice}</Text>
            )}

            <MessageComposer
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
                canEdit={
                    sheetTarget !== null &&
                    sheetTarget.status === 'sent' &&
                    isOwnMessage(currentUserId, sheetTarget.senderId) &&
                    sheetTarget.type === 'text' &&
                    sheetTarget.content !== null
                }
                canDelete={
                    sheetTarget !== null &&
                    sheetTarget.status === 'sent' &&
                    isOwnMessage(currentUserId, sheetTarget.senderId) &&
                    sheetTarget.id !== null
                }
                canDeleteOthers={
                    isOwner &&
                    sheetTarget !== null &&
                    sheetTarget.status === 'sent' &&
                    sheetTarget.id !== null &&
                    !isOwnMessage(currentUserId, sheetTarget.senderId)
                }
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
                    Alert.alert(
                        deletingOtherMember
                            ? 'Delete for everyone?'
                            : 'Delete message?',
                        deletingOtherMember
                            ? 'This message belongs to another member and will be removed for everyone in the group.'
                            : 'This message will be removed for everyone.',
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
                                    void conversation
                                        .remove(messageId)
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

/// Long-press action sheet (Reply / Edit / Delete / Cancel) --------------------

interface MessageActionSheetProps {
    target: ChatMessage | null;
    /** Edit is offered only for own text messages with content. */
    canEdit: boolean;
    /** Delete is offered only for own confirmed messages. */
    canDelete: boolean;
    /** Group owner may delete another member's confirmed message. */
    canDeleteOthers: boolean;
    onReply: () => void;
    onEdit: () => void;
    onDelete: () => void;
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
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Reply to message"
                        style={styles.sheetButton}
                        onPress={props.onReply}
                    >
                        <Text style={styles.sheetActionText}>Reply</Text>
                    </Pressable>
                    {props.canEdit && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Edit message"
                            style={styles.sheetButton}
                            onPress={props.onEdit}
                        >
                            <Text style={styles.sheetActionText}>Edit</Text>
                        </Pressable>
                    )}
                    {props.canDelete && (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Delete message"
                            style={styles.sheetButton}
                            onPress={props.onDelete}
                        >
                            <Text style={styles.sheetDeleteText}>Delete</Text>
                        </Pressable>
                    )}
                    {props.canDeleteOthers && (
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
                        <AppText variant="title">Edit message</AppText>
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
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
        backgroundColor: palette.neutral[0],
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: palette.neutral[100],
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
        backgroundColor: palette.neutral[0],
        borderRadius: radii.md,
        overflow: 'hidden',
    },
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
        backgroundColor: palette.neutral[0],
        borderRadius: radii.md,
        padding: spacing.md,
        gap: spacing.sm,
    },
    modalInput: {
        borderWidth: 1,
        borderColor: palette.neutral[300],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        minHeight: 60,
        color: palette.neutral[900],
        backgroundColor: palette.neutral[50],
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
        borderColor: palette.neutral[300],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        color: palette.neutral[900],
        backgroundColor: palette.neutral[0],
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
        color: palette.neutral[0],
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
