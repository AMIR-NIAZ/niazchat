import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppText, Screen, radii, spacing } from '../../shared/components';
import { useQueryClient } from '@tanstack/react-query';
import { palette, typography } from '../../shared/theme';
import { useChats, filterChats, invalidateChats } from '../../features/chats';
import { useAuthStore } from '../../features/auth';

/**
 * Chats screen — renders the WS-provided chat list.
 *
 * Documented limitations surfaced here (do NOT fake them):
 * - No unread counts: the backend provides none.
 * - Private chats have no title server-side; rows show a neutral label until a
 *   `chatlist:updated` event can provide context.
 * - lastMessage preview only appears after live update events.
 * - Search is client-side only (no server endpoint).
 */

type ChatRow = import('../../features/chats').ChatPreview;

export default function ChatsScreen(): React.ReactElement {
    const chatsQuery = useChats();
    const queryClient = useQueryClient();
    const clearSession = useAuthStore((state) => state.clearSession);
    const [search, setSearch] = useState('');

    // Updates missed while this screen was unmounted: refetch on focus.
    useFocusEffect(
        useCallback((): void => {
            void invalidateChats(queryClient);
        }, [queryClient]),
    );

    const chats = chatsQuery.data ?? [];
    const visible = filterChats(chats, search);

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
                        <ChatRowItem chat={item} />
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
        </Screen>
    );
}

function ChatRowItem({ chat }: { chat: ChatRow }): React.ReactElement {
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

    return (
        <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={(): void => {
                router.push({
                    pathname: '/(app)/chat/[chatId]',
                    params: { chatId: String(chat.id) },
                });
            }}
        >
            {avatar === undefined ? (
                <View style={styles.avatarFallback}>
                    <Text style={styles.avatarFallbackText}>
                        {name.slice(0, 1).toUpperCase()}
                    </Text>
                </View>
            ) : (
                <Image style={styles.avatar} source={{ uri: avatar }} />
            )}
            <View style={styles.rowBody}>
                <Text style={typography.title} numberOfLines={1}>
                    {name}
                </Text>
                <Text
                    style={[
                        typography.caption,
                        { color: palette.neutral[700] },
                    ]}
                    numberOfLines={1}
                >
                    {previewText}
                </Text>
            </View>
            <View style={styles.rowMeta}>
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
    },
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
