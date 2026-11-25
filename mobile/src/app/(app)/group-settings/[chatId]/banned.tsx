import { useMemo, useState } from 'react';
import {
    ActivityIndicator,
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
    SafeText,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../../../shared/components';
import { ApiError } from '../../../../core/api';
import { dialog, toast } from '../../../../shared/dialog';
import { openUserProfile } from '../../../../features/users';
import type { GroupBannedUser } from '../../../../features/groups/group-model';
import {
    canManageBans,
    useGroupBannedUsers,
    useGroupChangedEvents,
    useGroupInfo,
    useUnbanMember,
} from '../../../../features/groups';
import { useTheme, useThemedStyles } from '../../../../shared/theme';
import type { AppTheme } from '../../../../shared/theme';

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
    const styles = useThemedStyles(createStyles);
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
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const infoQuery = useGroupInfo(chatId);
    const info = infoQuery.data;
    const allowed = info !== undefined && canManageBans(info.capabilities);
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
                toast.show(
                    `${displayName(user)} can join this group again.`,
                    { tone: 'success' },
                );
            })
            .catch((error: unknown): void => {
                dialog.show({
                    title: 'Could not unban user',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Please try again.',
                    tone: 'danger',
                });
            })
            .finally((): void => setPendingMemberId(null));
    };

    const confirmUnban = (user: GroupBannedUser): void => {
        if (pendingMemberId !== null) return;
        void dialog
            .confirm({
                title: `Unban ${displayName(user)}?`,
                message:
                    'They become a regular member again and can rejoin this group. A former admin comes back as a member.',
                confirmText: 'Unban',
                destructive: true,
            })
            .then((confirmed): void => {
                if (confirmed) {
                    runUnban(user);
                }
            });
    };

    if (infoQuery.isPending) {
        return (
            <View style={styles.root}>
                <TopBar />
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={theme.accent}
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
                        <SafeText variant="title" lines={2}>
                            {info.title || 'Unnamed group'}
                        </SafeText>
                        <AppText style={styles.caption}>
                            Banned users cannot rejoin until you unban them.
                        </AppText>
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
                                color={theme.accent}
                            />
                        </View>
                    ) : listError !== null ? (
                        <View style={styles.state}>
                            <AppText style={styles.stateTitle}>
                                Could not load banned users
                            </AppText>
                            <AppText style={styles.stateDetail}>{listError}</AppText>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry loading banned users"
                                style={styles.retryButton}
                                onPress={(): void => {
                                    void bannedQuery.refetch();
                                }}
                            >
                                <AppText style={styles.retryText}>Retry</AppText>
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.state}>
                            <AppText style={styles.stateTitle}>
                                No banned users
                            </AppText>
                        </View>
                    )
                }
                ListFooterComponent={
                    bannedQuery.isFetchingNextPage ? (
                        <View style={styles.footer}>
                            <ActivityIndicator
                                size="small"
                                color={theme.accent}
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
                        tintColor={theme.accent}
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
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
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
                    <SafeText style={styles.rowName} lines={1}>
                        {name}
                    </SafeText>
                    {user.username !== '' && (
                        <AppText style={styles.rowUsername} numberOfLines={1}>
                            @{user.username}
                        </AppText>
                    )}
                    {bannedOn !== null && (
                        <AppText style={styles.rowMeta} numberOfLines={1}>
                            {bannedOn}
                        </AppText>
                    )}
                </View>
            </Pressable>
            {props.pending ? (
                <View style={styles.unbanButton}>
                    <ActivityIndicator
                        size="small"
                        color={theme.accent}
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
                    <AppText style={styles.unbanText}>Unban</AppText>
                </Pressable>
            )}
        </View>
    );
}

function TopBar(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={(): void => router.back()}
            >
                <AppText style={styles.backText}>‹</AppText>
            </Pressable>
            <AppText style={styles.topBarTitle} numberOfLines={1}>
                Banned users
            </AppText>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function StateBlock(props: {
    title: string;
    detail: string;
    onRetry?: () => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
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
                    <AppText style={styles.retryText}>Retry</AppText>
                </Pressable>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backLink}
                onPress={(): void => router.back()}
            >
                <AppText style={styles.backLinkText}>Go back</AppText>
            </Pressable>
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.glassElevated,
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: { fontSize: 32, lineHeight: 34, color: theme.colors.text },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
    },
    topBarSpacer: { width: 44 },
    list: { paddingBottom: spacing.xl },
    listHeader: { padding: spacing.md },
    caption: { ...theme.type.caption, marginTop: spacing.xxs },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 64,
        paddingHorizontal: spacing.md,
        backgroundColor: theme.colors.glassElevated,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
    },
    rowPressed: { backgroundColor: theme.colors.glassElevated },
    identity: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
    },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowName: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
    rowUsername: theme.type.caption,
    rowMeta: { ...theme.type.caption, color: theme.colors.textSecondary },
    unbanButton: {
        flexShrink: 0,
        minWidth: 72,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
    },
    unbanText: {
        color: theme.colors.danger,
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
        color: theme.colors.text,
    },
    stateDetail: { ...theme.type.caption, textAlign: 'center' },
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
        backgroundColor: theme.accent,
    },
    retryText: {
        color: theme.colors.accentText,
        fontSize: 14,
        fontWeight: '600',
    },
    backLink: { padding: spacing.sm },
    backLinkText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.accent,
    },
});
