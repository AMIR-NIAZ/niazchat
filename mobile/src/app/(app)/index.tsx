import { useCallback, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
    AppText,
    GlassHeader,
    GlassInput,
    GlassSurface,
    Screen,
    radii,
    spacing,
} from '../../shared/components';
import { useQueryClient } from '@tanstack/react-query';
import { palette } from '../../shared/theme';
import { measureInWindow, useContextPopup } from '../../shared/context-popup';
import type { PopupRect } from '../../shared/context-popup';
import { ApiError } from '../../core/api';
import {
    ChatRowContent,
    ChatRowPreview,
    chatPreviewText,
    filterChats,
    getChatListActions,
    invalidateChats,
    myChatRoleQuery,
    isPrivateChat,
    purgeChatFromCaches,
    setChatUnreadCount,
    sortPinnedFirst,
    useChats,
    useLeaveGroup,
    usePinnedChatIds,
} from '../../features/chats';
import type { ChatListActionId, ChatRole } from '../../features/chats';
import { markChatSeen } from '../../features/messages';
import { openUserProfile } from '../../features/users';
import { logout, useCurrentUserId } from '../../features/auth';
import { CircleUserRound, LogOut, UserPlus } from 'lucide-react-native';

/**
 * Chats screen — renders the WS-provided chat list.
 *
 * Unread counts come from `getAllChats` (authoritative) and are incremented
 * locally by live `chatlist:updated` events; reading a chat resets them.
 * Remaining limitations surfaced here (do NOT fake them):
 * - Private chats have no title server-side; rows show a neutral label.
 * - Search is client-side only (no server endpoint).
 */

type ChatRow = import('../../features/chats').ChatPreview;

export default function ChatsScreen(): React.ReactElement {
    const chatsQuery = useChats();
    const queryClient = useQueryClient();
    const popup = useContextPopup();
    const [search, setSearch] = useState('');
    const currentUserId = useCurrentUserId();
    const { pinned, togglePin } = usePinnedChatIds(currentUserId);
    const leaveGroup = useLeaveGroup();

    // Updates missed while this screen was unmounted: refetch on focus.
    useFocusEffect(
        useCallback((): void => {
            void invalidateChats(queryClient);
        }, [queryClient]),
    );

    const chats = chatsQuery.data ?? [];
    const visible = useMemo(
        () => sortPinnedFirst(filterChats(chats, search), pinned),
        [chats, search, pinned],
    );

    /// Floating chat-list popup ------------------------------------------------

    const markChatRead = (chat: ChatRow): void => {
        if (chat.lastMessage === null) {
            return;
        }
        const chatId = Number(chat.id);
        const previous = chat.unreadCount;
        // Optimistic: the badge clears immediately, the ack is authoritative.
        setChatUnreadCount(queryClient, chatId, 0);
        void markChatSeen(chatId, chat.lastMessage.id).catch(
            (error: unknown) => {
                setChatUnreadCount(queryClient, chatId, previous);
                Alert.alert(
                    'Could not mark as read',
                    error instanceof Error
                        ? error.message
                        : 'Try again in a moment.',
                );
            },
        );
    };

    const confirmLeaveGroup = (chat: ChatRow): void => {
        const chatId = Number(chat.id);
        Alert.alert(
            'Leave group?',
            'You will be removed from this group and will no longer receive its messages. An admin will have to add you again.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Leave',
                    style: 'destructive',
                    onPress: (): void => {
                        void leaveGroup
                            .mutateAsync(chatId)
                            .then((): void => {
                                purgeChatFromCaches(queryClient, chatId);
                                Alert.alert(
                                    'Left group',
                                    'You are no longer a member of this group.',
                                );
                            })
                            .catch((error: unknown) => {
                                // 403/404: membership is already gone server
                                // side — drop local access the same way.
                                if (
                                    error instanceof ApiError &&
                                    (error.statusCode === 403 ||
                                        error.statusCode === 404)
                                ) {
                                    purgeChatFromCaches(queryClient, chatId);
                                    Alert.alert(
                                        'Left group',
                                        'You are no longer a member of this group.',
                                    );
                                    return;
                                }
                                Alert.alert(
                                    'Could not leave group',
                                    error instanceof Error
                                        ? error.message
                                        : 'Try again in a moment.',
                                );
                            });
                    },
                },
            ],
        );
    };

    const runChatAction = (chat: ChatRow, action: ChatListActionId): void => {
        const chatId = Number(chat.id);
        switch (action) {
            case 'pin':
            case 'unpin':
                togglePin(chatId);
                return;
            case 'mark-read':
                markChatRead(chat);
                return;
            case 'group-info':
                router.push(`/(app)/group/${chatId}`);
                return;
            case 'view-profile': {
                const peer = chat.peer;
                if (peer === null) return;
                openUserProfile({
                    userId: peer.id,
                    name: peer.name,
                    avatar: peer.avatars[0] ?? null,
                });
                return;
            }
            case 'leave-group':
                confirmLeaveGroup(chat);
                return;
        }
    };

    /** Warms the caller's role while the row is held, so the menu is instant. */
    const prefetchRole = (chat: ChatRow): void => {
        if (isPrivateChat(chat)) {
            return;
        }
        void queryClient.prefetchQuery(myChatRoleQuery(Number(chat.id)));
    };

    const openChatMenu = async (
        chat: ChatRow,
        anchor: PopupRect,
    ): Promise<void> => {
        const chatId = Number(chat.id);
        const isPinned = pinned.has(chatId);
        let role: ChatRole | null = null;
        if (!isPrivateChat(chat)) {
            // The owner cannot leave; the row is hidden without the role.
            role = await queryClient
                .ensureQueryData(myChatRoleQuery(chatId))
                .catch((): ChatRole | null => null);
        }
        const rows = getChatListActions(chat, {
            markSeenAvailable: true,
            pinned: isPinned,
            role,
        });
        // Nothing to offer (no action available): the long press does nothing.
        if (rows.length === 0) {
            return;
        }
        popup.open({
            anchor,
            align: 'start',
            actions: rows.map((action) => ({
                id: action.id,
                label: action.label,
                icon: action.icon,
                destructive: action.destructive,
                onPress: (): void => runChatAction(chat, action.id),
            })),
            preview: (
                <ChatRowPreview
                    chat={chat}
                    pinned={isPinned}
                    previewText={chatPreviewText(chat.lastMessage)}
                    width={anchor.width}
                />
            ),
            accessibilityLabel: 'Chat actions',
        });
    };

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <GlassHeader
                leading={
                    <View style={styles.brand}>
                        <Text style={styles.brandText}>N</Text>
                    </View>
                }
                trailing={
                    <>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="New chat"
                            onPress={(): void => {
                                router.push('/(app)/new-chat');
                            }}
                            style={styles.iconButton}
                        >
                            <UserPlus
                                size={26}
                                color="#7e00e6"
                                strokeWidth={2}
                            />
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Open profile"
                            onPress={(): void => {
                                router.push('/(app)/profile');
                            }}
                            style={styles.iconButton}
                        >
                            <CircleUserRound
                                size={26}
                                color="#7e00e6"
                                strokeWidth={2}
                            />
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Sign out"
                            onPress={(): void => {
                                void logout('manual');
                            }}
                            style={styles.iconButton}
                        >
                            <LogOut
                                size={26}
                                color="#7e00e6"
                                strokeWidth={2}
                            />

                        </Pressable>
                    </>
                }
            >
                <AppText variant="heading">Chats</AppText>
                <AppText variant="caption" style={styles.headerCaption}>
                    Your conversations
                </AppText>
            </GlassHeader>

            <GlassInput
                placeholder="Search chats"
                value={search}
                onChangeText={setSearch}
                accessibilityLabel="Search chats"
                leading={<Text style={styles.searchGlyph}>⌕</Text>}
            />

            {chatsQuery.isPending ? (
                <View style={styles.center}>
                    <ActivityIndicator
                        size="large"
                        color={palette.primary[500]}
                    />
                </View>
            ) : chatsQuery.isError ? (
                <StateBlock
                    title="Could not load chats"
                    detail={chatsQuery.error.message}
                    retry={(): void => {
                        void chatsQuery.refetch();
                    }}
                />
            ) : visible.length === 0 ? (
                <StateBlock
                    title={search === '' ? 'No chats yet' : 'No matching chats'}
                    detail={
                        search === ''
                            ? 'Start a private chat with "New chat" or create a group with "+ Group".'
                            : 'Try a different search term.'
                    }
                    retry={
                        search === ''
                            ? (): void => {
                                void chatsQuery.refetch();
                            }
                            : undefined
                    }
                />
            ) : (
                <FlatList
                    data={visible}
                    keyExtractor={(item: ChatRow): string => String(item.id)}
                    refreshControl={
                        <RefreshControl
                            refreshing={chatsQuery.isRefetching}
                            onRefresh={(): void => {
                                void chatsQuery.refetch();
                            }}
                        />
                    }
                    renderItem={({ item }): React.ReactElement => (
                        <ChatRowItem
                            chat={item}
                            pinned={pinned.has(Number(item.id))}
                            onHold={prefetchRole}
                            onLongPress={openChatMenu}
                        />
                    )}
                    ItemSeparatorComponent={RowSeparator}
                />
            )}

            <GlassSurface
                tone="accent"
                radius={radii.full}
                floating={true}
                style={styles.fabWrap}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Create a group"
                    style={styles.fab}
                    onPress={(): void => {
                        router.push('/(app)/create-group');
                    }}
                >
                    <Text style={styles.fabText}>＋ Group</Text>
                </Pressable>
            </GlassSurface>
        </Screen>
    );
}

interface ChatRowItemProps {
    chat: ChatRow;
    pinned: boolean;
    /** Runs while the row is held: warms whatever the menu needs. */
    onHold: (chat: ChatRow) => void;
    onLongPress: (chat: ChatRow, anchor: PopupRect) => void | Promise<void>;
}

const LONG_PRESS_MS = 350;

function ChatRowItem(props: ChatRowItemProps): React.ReactElement {
    const { chat, pinned } = props;
    const rowRef = useRef<ComponentRef<typeof View>>(null);
    // Releasing a hold that opened the menu must not also navigate.
    const pressStartedAtRef = useRef(0);
    const previewText = chatPreviewText(chat.lastMessage);

    return (
        <Pressable
            ref={rowRef}
            accessibilityRole="button"
            accessibilityHint="Tap to open, long press for chat actions"
            delayLongPress={LONG_PRESS_MS}
            onPressIn={(): void => {
                pressStartedAtRef.current = Date.now();
                props.onHold(chat);
            }}
            onLongPress={(): void => {
                void measureInWindow(rowRef).then((anchor): void => {
                    if (anchor === null) {
                        return;
                    }
                    void props.onLongPress(chat, anchor);
                });
            }}
            onPress={(): void => {
                if (Date.now() - pressStartedAtRef.current >= LONG_PRESS_MS) {
                    return;
                }
                router.push({
                    pathname: '/(app)/chat/[chatId]',
                    params: { chatId: String(chat.id) },
                });
            }}
        >
            <ChatRowContent
                chat={chat}
                pinned={pinned}
                previewText={previewText}
            />
        </Pressable>
    );
}

function RowSeparator(): React.ReactElement {
    return <View style={styles.separator} />;
}

function StateBlock(props: {
    title: string;
    detail: string;
    retry?: (() => void) | undefined;
}): React.ReactElement {
    return (
        <View style={styles.center}>
            <AppText variant="title">{props.title}</AppText>
            <AppText style={styles.stateDetail}>{props.detail}</AppText>
            {props.retry !== undefined && <RetryButton onPress={props.retry} />}
        </View>
    );
}

function RetryButton({ onPress }: { onPress: () => void }): React.ReactElement {
    return (
        <Pressable
            accessibilityRole="button"
            style={styles.buttonGhost}
            onPress={onPress}
        >
            <Text style={styles.buttonGhostText}>Retry</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { gap: spacing.sm },
    brand: {
        width: 40,
        height: 40,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.glass.accent,
        borderWidth: 1,
        borderColor: palette.border.accent,
    },
    brandText: {
        color: palette.highlight,
        fontSize: 19,
        fontWeight: '700',
    },
    headerCaption: { color: palette.text.muted },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.glass.highlight,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    iconText: {
        color: palette.primary[700],
        fontSize: 18,
        fontWeight: '600',
    },
    searchGlyph: { color: palette.text.muted, fontSize: 20 },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
    },
    stateDetail: { textAlign: 'center', color: palette.neutral[500] },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xxs,
        borderRadius: radii.sm,
    },
    rowSelected: {
        backgroundColor: palette.glass.elevated,
        borderWidth: 1,
        borderColor: palette.border.subtle,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
    },
    titleText: { flexShrink: 1 },
    pinGlyph: { fontSize: 11 },
    avatar: { width: 44, height: 44, borderRadius: radii.full / 2 },
    avatarFallback: {
        width: 44,
        height: 44,
        borderRadius: radii.full / 2,
        backgroundColor: palette.primary[100],
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarFallbackText: {
        color: palette.primary[700],
        fontSize: 16,
        fontWeight: '700',
    },
    rowBody: { flex: 1, gap: 2 },
    rowMeta: { alignItems: 'flex-end', gap: 2 },
    unreadPreview: { color: palette.text.primary, fontWeight: '700' },
    unreadBadge: {
        minWidth: 18,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: radii.full / 2,
        backgroundColor: palette.primary[500],
        alignItems: 'center',
        justifyContent: 'center',
    },
    unreadBadgeText: {
        color: palette.text.onAccent,
        fontSize: 10,
        fontWeight: '700',
    },
    banBadge: { color: palette.semantic.danger, fontSize: 10 },
    separator: { height: 1, backgroundColor: palette.border.subtle },
    fabWrap: {
        position: 'absolute',
        end: spacing.lg,
        bottom: spacing.lg,
    },
    fab: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    fabText: {
        color: palette.text.onAccent,
        fontWeight: '700',
        fontSize: 14,
    },
    buttonGhost: {
        borderWidth: 1,
        borderColor: palette.border.strong,
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        backgroundColor: palette.glass.elevated,
    },
    buttonGhostText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
});
