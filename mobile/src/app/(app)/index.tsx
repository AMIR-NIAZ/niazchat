import { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
    AppText,
    Screen,
    UserAvatar,
    radii,
    spacing,
} from '../../shared/components';
import { useQueryClient } from '@tanstack/react-query';
import { palette, typography } from '../../shared/theme';
import {
    ChatContextMenu,
    filterChats,
    invalidateChats,
    sortPinnedFirst,
    useChats,
    usePinnedChatIds,
} from '../../features/chats';
import { useAuthStore, useCurrentUserId } from '../../features/auth';

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
    const clearSession = useAuthStore((state) => state.clearSession);
    const [search, setSearch] = useState('');
    const [menuChat, setMenuChat] = useState<ChatRow | null>(null);
    const currentUserId = useCurrentUserId();
    const { pinned, togglePin } = usePinnedChatIds(currentUserId);

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

    return (
        <Screen style={styles.screen} withTopInset={true}>
            <View style={styles.header}>
                <AppText variant="title">Chats</AppText>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open profile"
                    onPress={(): void => {
                        router.push('/(app)/profile');
                    }}
                    style={styles.buttonGhost}
                >
                    <Text style={styles.buttonGhostText}>Profile</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    onPress={(): void => {
                        void clearSession();
                    }}
                    style={styles.buttonGhost}
                >
                    <Text style={styles.buttonGhostText}>Sign out</Text>
                </Pressable>
            </View>

            <TextInput
                style={styles.search}
                placeholder="Search chats"
                placeholderTextColor={palette.neutral[300]}
                value={search}
                onChangeText={setSearch}
                accessibilityLabel="Search chats"
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
                            ? 'Create a group or start a private chat from messaging (coming next).'
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
                            selected={
                                menuChat !== null &&
                                Number(menuChat.id) === Number(item.id)
                            }
                            onLongPress={setMenuChat}
                        />
                    )}
                    ItemSeparatorComponent={RowSeparator}
                />
            )}

            <Pressable
                accessibilityRole="button"
                style={styles.fab}
                onPress={(): void => {
                    router.push('/(app)/create-group');
                }}
            >
                <Text style={styles.fabText}>+ Group</Text>
            </Pressable>

            <ChatContextMenu
                chat={menuChat}
                pinned={menuChat !== null && pinned.has(Number(menuChat.id))}
                onClose={(): void => setMenuChat(null)}
                onTogglePin={togglePin}
            />
        </Screen>
    );
}

interface ChatRowItemProps {
    chat: ChatRow;
    pinned: boolean;
    selected: boolean;
    onLongPress: (chat: ChatRow) => void;
}

const LONG_PRESS_MS = 350;

function ChatRowItem(props: ChatRowItemProps): React.ReactElement {
    const { chat, pinned, selected } = props;
    // Releasing a hold that opened the menu must not also navigate.
    const pressStartedAtRef = useRef(0);
    const name =
        chat.title ??
        (chat.type === 'private' ? 'Private chat' : 'Unnamed group');
    const avatar = chat.avatarUrls.length > 0 ? chat.avatarUrls[0] : undefined;
    const previewText =
        chat.lastMessage === null
            ? '—'
            : chat.lastMessage.content !== ''
              ? chat.lastMessage.content
              : `${chat.lastMessage.attachmentCount} attachment(s)`;
    const time = chat.lastMessage?.createdAt ?? chat.updatedAt;
    const unread = chat.unreadCount;
    const unreadLabel = unread > 99 ? '99+' : String(unread);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityHint="Tap to open, long press for chat actions"
            delayLongPress={LONG_PRESS_MS}
            style={[styles.row, selected && styles.rowSelected]}
            onPressIn={(): void => {
                pressStartedAtRef.current = Date.now();
            }}
            onLongPress={(): void => {
                props.onLongPress(chat);
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
            <UserAvatar
                userId={Number(chat.id)}
                name={name}
                uri={avatar}
                size={44}
            />
            <View style={styles.rowBody}>
                <View style={styles.titleRow}>
                    <Text
                        style={[typography.title, styles.titleText]}
                        numberOfLines={1}
                    >
                        {name}
                    </Text>
                    {pinned && (
                        <Text
                            style={styles.pinGlyph}
                            accessibilityLabel="Pinned chat"
                        >
                            📌
                        </Text>
                    )}
                </View>
                <Text
                    style={[
                        typography.caption,
                        { color: palette.neutral[700] },
                        unread > 0 && styles.unreadPreview,
                    ]}
                    numberOfLines={1}
                >
                    {previewText}
                </Text>
            </View>
            <View style={styles.rowMeta}>
                {unread > 0 && (
                    <View
                        style={styles.unreadBadge}
                        accessibilityLabel={`${unread} unread messages`}
                    >
                        <Text style={styles.unreadBadgeText}>
                            {unreadLabel}
                        </Text>
                    </View>
                )}
                <Text style={typography.caption}>{time.slice(11, 16)}</Text>
                {chat.isBan && <Text style={styles.banBadge}>banned</Text>}
            </View>
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    search: {
        borderWidth: 1,
        borderColor: palette.neutral[300],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        color: palette.neutral[900],
        backgroundColor: palette.neutral[0],
    },
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
    rowSelected: { backgroundColor: palette.primary[100] },
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
    unreadPreview: { color: palette.neutral[900], fontWeight: '700' },
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
        color: palette.neutral[0],
        fontSize: 10,
        fontWeight: '700',
    },
    banBadge: { color: palette.semantic.danger, fontSize: 10 },
    separator: { height: 1, backgroundColor: palette.neutral[100] },
    fab: {
        alignSelf: 'flex-end',
        backgroundColor: palette.primary[500],
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
    },
    fabText: { color: palette.neutral[0], fontWeight: '600' },
    buttonGhost: {
        borderWidth: 1,
        borderColor: palette.primary[500],
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
    },
    buttonGhostText: {
        color: palette.primary[600],
        fontSize: 13,
        fontWeight: '600',
    },
});
