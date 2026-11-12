import { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
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
    UserAvatar,
    radii,
    spacing,
} from '../../shared/components';
import { useQueryClient } from '@tanstack/react-query';
import { palette, typography } from '../../shared/theme';
import {
    ChatContextMenu,
    chatPreviewText,
    filterChats,
    getChatDisplay,
    invalidateChats,
    sortPinnedFirst,
    useChats,
    usePinnedChatIds,
} from '../../features/chats';
import { logout, useCurrentUserId } from '../../features/auth';

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
                            <Text style={styles.iconText}>＋</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Open profile"
                            onPress={(): void => {
                                router.push('/(app)/profile');
                            }}
                            style={styles.iconButton}
                        >
                            <Text style={styles.iconText}>☺</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Sign out"
                            onPress={(): void => {
                                void logout('manual');
                            }}
                            style={styles.iconButton}
                        >
                            <Text style={styles.iconText}>⏻</Text>
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
    const display = getChatDisplay(chat);
    const name = display.title;
    const avatar = display.avatarUri;
    const previewText = chatPreviewText(chat.lastMessage);
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
                userId={display.userId ?? Number(chat.id)}
                name={name}
                uri={avatar}
                size={44}
            />
            <View style={styles.rowBody}>
                <View style={styles.titleRow}>
                    <Text
                        style={[typography.heading, styles.titleText]}
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
                        { color: palette.text.secondary },
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
