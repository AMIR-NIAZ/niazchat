import { useMemo, useState } from 'react';
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
import type { ListRenderItemInfo } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
    AppText,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../../../shared/components';
import { ApiError } from '../../../../core/api';
import { openUserProfile } from '../../../../features/users';
import type { GroupBannedUser } from '../../../../features/groups/group-model';
import {
    useGroupBannedUsers,
    useGroupChangedEvents,
    useGroupInfo,
    useUnbanMember,
} from '../../../../features/groups';

/**
 * "Banned users" (`/group-settings/:chatId/banned`).
 *
 * Owner, or an admin holding `ban_user`/`all` (server-computed
 * `capabilities.canManageBans`); everyone else sees the no-access state and the
 * endpoint would answer 403 for them anyway. Paginated like the members screen;
 * unban is optimistic with rollback and refreshes the member list, because an
 * unbanned former admin returns as a plain member.
 */

type BannedRouteParams = { chatId?: string | string[] };

function parseChatId(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function BannedUsersScreen(): React.ReactElement {
    const params = useLocalSearchParams<BannedRouteParams>();
    const chatId = parseChatId(params.chatId);

    if (chatId === null) {
        return (
            <View style={styles.root}>
                <TopBar />
                <StateBlock
                    title="Banned users"
                    detail="This link is not valid."
                />
            </View>
        );
    }
    return <BannedUsers chatId={chatId} />;
}

function BannedUsers({ chatId }: { chatId: number }): React.ReactElement {
    const infoQuery = useGroupInfo(chatId);
    const info = infoQuery.data;
    const allowed = info?.capabilities?.canManageBans === true;
    const bannedQuery = useGroupBannedUsers(chatId, allowed);
    const unban = useUnbanMember(chatId);
    const [pendingMemberId, setPendingMemberId] = useState<number | null>(null);

    useGroupChangedEvents(chatId);

    const users = useMemo(
        () => bannedQuery.data?.pages.flatMap((page) => page.items) ?? [],
        [bannedQuery.data],
    );

    const describeError = (error: Error | null): string => {
        if (error instanceof ApiError && error.statusCode === 403) {
            return "You don't have permission to see this group's banned users.";
        }
        if (error instanceof ApiError && error.statusCode === 400) {
            return 'This screen is only available for groups.';
        }
        return error?.message ?? 'Could not load banned users.';
    };

    const runUnban = (user: GroupBannedUser): void => {
        setPendingMemberId(user.memberId);
        unban
            .mutateAsync(user)
            .then((): void => {
                Alert.alert(
                    'User unbanned',
                    `${displayName(user)} can join this group again.`,
                );
            })
            .catch((error: unknown): void => {
                Alert.alert(
                    'Could not unban user',
                    error instanceof Error
                        ? error.message
                        : 'Please try again.',
                );
            })
            .finally((): void => setPendingMemberId(null));
    };

    const confirmUnban = (user: GroupBannedUser): void => {
        if (pendingMemberId !== null) return;
        Alert.alert(
            `Unban ${displayName(user)}?`,
            'They become a regular member again and can rejoin this group. A former admin comes back as a member.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Unban',
                    style: 'destructive',
                    onPress: (): void => runUnban(user),
                },
            ],
        );
    };

    if (infoQuery.isPending) {
        return (
            <View style={styles.root}>
                <TopBar />
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={palette.primary[500]}
                    />
                </View>
            </View>
        );
    }

    if (infoQuery.isError || info === undefined) {
        return (
            <View style={styles.root}>
                <TopBar />
                <StateBlock
                    title="Banned users unavailable"
                    detail={describeError(infoQuery.error)}
                    onRetry={(): void => {
                        void infoQuery.refetch();
                    }}
                />
            </View>
        );
    }

    if (!allowed) {
        return (
            <View style={styles.root}>
                <TopBar />
                <StateBlock
                    title="Banned users"
                    detail="You don't have permission to see this group's banned users."
                />
            </View>
        );
    }

    const listError =
        bannedQuery.isError && users.length === 0
            ? describeError(bannedQuery.error)
            : null;

    return (
        <View style={styles.root}>
            <TopBar />
            <FlatList
                data={users}
                keyExtractor={(item): string => `banned-${item.memberId}`}
                contentContainerStyle={styles.list}
                ListHeaderComponent={
                    <View style={styles.listHeader}>
                        <AppText variant="title" numberOfLines={2}>
                            {info.title || 'Unnamed group'}
                        </AppText>
                        <Text style={styles.caption}>
                            Banned users cannot rejoin until you unban them.
                        </Text>
                    </View>
                }
                renderItem={({
                    item,
                }: ListRenderItemInfo<GroupBannedUser>) => (
                    <BannedRow
                        user={item}
                        pending={pendingMemberId === item.memberId}
                        busy={pendingMemberId !== null}
                        onOpenProfile={(): void =>
                            openUserProfile({
                                userId: item.userId,
                                name: item.name,
                                avatar: item.avatars[0] ?? null,
                            })
                        }
                        onUnban={(): void => confirmUnban(item)}
                    />
                )}
                ListEmptyComponent={
                    bannedQuery.isPending ? (
                        <View style={styles.state}>
                            <ActivityIndicator
                                size="small"
                                color={palette.primary[500]}
                            />
                        </View>
                    ) : listError !== null ? (
                        <View style={styles.state}>
                            <Text style={styles.stateTitle}>
                                Could not load banned users
                            </Text>
                            <Text style={styles.stateDetail}>{listError}</Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry loading banned users"
                                style={styles.retryButton}
                                onPress={(): void => {
                                    void bannedQuery.refetch();
                                }}
                            >
                                <Text style={styles.retryText}>Retry</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.state}>
                            <Text style={styles.stateTitle}>
                                No banned users
                            </Text>
                        </View>
                    )
                }
                ListFooterComponent={
                    bannedQuery.isFetchingNextPage ? (
                        <View style={styles.footer}>
                            <ActivityIndicator
                                size="small"
                                color={palette.primary[500]}
                            />
                        </View>
                    ) : undefined
                }
                refreshControl={
                    <RefreshControl
                        refreshing={
                            bannedQuery.isRefetching &&
                            !bannedQuery.isFetchingNextPage
                        }
                        onRefresh={(): void => {
                            void infoQuery.refetch();
                            void bannedQuery.refetch();
                        }}
                        tintColor={palette.primary[500]}
                    />
                }
                onEndReached={(): void => {
                    if (
                        bannedQuery.hasNextPage &&
                        !bannedQuery.isFetchingNextPage
                    ) {
                        void bannedQuery.fetchNextPage();
                    }
                }}
                onEndReachedThreshold={0.4}
            />
        </View>
    );
}

function displayName(user: GroupBannedUser): string {
    return user.name || user.username || 'This user';
}

function BannedRow(props: {
    user: GroupBannedUser;
    pending: boolean;
    busy: boolean;
    onOpenProfile: () => void;
    onUnban: () => void;
}): React.ReactElement {
    const user = props.user;
    const name = displayName(user);
    const bannedOn =
        user.bannedAt === null
            ? null
            : `Banned ${user.bannedAt.slice(0, 10)}`;

    return (
        <View style={styles.row}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open profile of ${name}`}
                onPress={props.onOpenProfile}
                style={({ pressed }) => [
                    styles.identity,
                    pressed && styles.rowPressed,
                ]}
            >
                <UserAvatar
                    userId={user.userId}
                    name={name}
                    uri={user.avatars[0] ?? null}
                    size={40}
                />
                <View style={styles.rowBody}>
                    <Text style={styles.rowName} numberOfLines={1}>
                        {name}
                    </Text>
                    {user.username !== '' && (
                        <Text style={styles.rowUsername} numberOfLines={1}>
                            @{user.username}
                        </Text>
                    )}
                    {bannedOn !== null && (
                        <Text style={styles.rowMeta} numberOfLines={1}>
                            {bannedOn}
                        </Text>
                    )}
                </View>
            </Pressable>
            {props.pending ? (
                <View style={styles.unbanButton}>
                    <ActivityIndicator
                        size="small"
                        color={palette.primary[500]}
                    />
                </View>
            ) : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Unban ${name}`}
                    accessibilityState={{ disabled: props.busy }}
                    disabled={props.busy}
                    onPress={props.onUnban}
                    style={({ pressed }) => [
                        styles.unbanButton,
                        pressed && styles.rowPressed,
                    ]}
                >
                    <Text style={styles.unbanText}>Unban</Text>
                </Pressable>
            )}
        </View>
    );
}

function TopBar(): React.ReactElement {
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={(): void => router.back()}
            >
                <Text style={styles.backText}>‹</Text>
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
                Banned users
            </Text>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function StateBlock(props: {
    title: string;
    detail: string;
    onRetry?: () => void;
}): React.ReactElement {
    return (
        <View style={styles.centered}>
            <AppText variant="title">{props.title}</AppText>
            <AppText variant="caption" style={styles.centeredCaption}>
                {props.detail}
            </AppText>
            {props.onRetry !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading banned users"
                    style={styles.retryButton}
                    onPress={props.onRetry}
                >
                    <Text style={styles.retryText}>Retry</Text>
                </Pressable>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backLink}
                onPress={(): void => router.back()}
            >
                <Text style={styles.backLinkText}>Go back</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.background },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.neutral[100],
        backgroundColor: palette.elevated,
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: { fontSize: 32, lineHeight: 34, color: palette.neutral[900] },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    topBarSpacer: { width: 44 },
    list: { paddingBottom: spacing.xl },
    listHeader: { padding: spacing.md },
    caption: { ...typography.caption, marginTop: spacing.xxs },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 64,
        paddingHorizontal: spacing.md,
        backgroundColor: palette.elevated,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.neutral[100],
    },
    rowPressed: { backgroundColor: palette.neutral[100] },
    identity: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
    },
    rowBody: { flex: 1, gap: 2 },
    rowName: { fontSize: 16, fontWeight: '600', color: palette.neutral[900] },
    rowUsername: typography.caption,
    rowMeta: { ...typography.caption, color: palette.neutral[500] },
    unbanButton: {
        minWidth: 72,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
    },
    unbanText: {
        color: palette.semantic.danger,
        fontSize: 14,
        fontWeight: '700',
    },
    footer: { paddingVertical: spacing.md, alignItems: 'center' },
    state: {
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.lg,
    },
    stateTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: palette.neutral[700],
    },
    stateDetail: { ...typography.caption, textAlign: 'center' },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.lg,
    },
    centeredCaption: { textAlign: 'center' },
    retryButton: {
        marginTop: spacing.xs,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: palette.primary[500],
    },
    retryText: {
        color: palette.text.onAccent,
        fontSize: 14,
        fontWeight: '600',
    },
    backLink: { padding: spacing.sm },
    backLinkText: {
        fontSize: 14,
        fontWeight: '600',
        color: palette.primary[700],
    },
});
