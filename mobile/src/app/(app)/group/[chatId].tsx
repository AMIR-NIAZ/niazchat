import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    AppText,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../../shared/components';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { ApiError } from '../../../core/api';
import { useCurrentUserId } from '../../../features/auth';
import { purgeChatFromCaches } from '../../../features/chats';
import {
    AvatarGallery,
    AvatarViewer,
} from '../../../features/users/avatar-gallery';
import { openUserProfile } from '../../../features/users';
import { MemberActionsSheet } from '../../../features/groups/member-actions-sheet';
import { MemberPermissionsSheet } from '../../../features/groups/member-permissions-sheet';
import {
    canOpenGroupSettings,
    groupHasPhotoGallery,
    groupPhotoActions,
    hasMemberActions,
    roleBadgeLabel,
} from '../../../features/groups/group-model';
import type {
    GroupMember,
    GroupMemberAction,
} from '../../../features/groups/group-model';
import {
    describeMemberActionError,
    groupAvatarItems,
    useDeleteGroupAvatar,
    useDemoteMember,
    useGroupChangedEvents,
    useGroupInfo,
    useGroupMembers,
    useGroupRemovedEvent,
    usePromoteMember,
    useRefetchGroupOnFocus,
    useRemoveMember,
    useGroupUpdatedEvents,
    useSetMainGroupAvatar,
} from '../../../features/groups/use-group';
import { describeGroupAvatarError } from '../../../features/groups/group-errors';

/**
 * GROUP INFO panel — reachable from a group chat header only.
 *
 * Every member can read the group info and the (paginated, searchable) member
 * list. The three-dot trigger appears only when the server computed at least
 * one permitted action for the row, and the sheet renders exactly those flags.
 * This screen never joins or leaves the chat room; pushing it over the chat
 * keeps the conversation mounted (scroll position + draft survive).
 */

const NOTICE_MS = 2500;

type ManageMemberAction = Exclude<GroupMemberAction, 'permissions'>;

type GroupRouteParams = { chatId?: string | string[] };

function parseChatId(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function GroupScreen(): React.ReactElement {
    const params = useLocalSearchParams<GroupRouteParams>();
    const chatId = parseChatId(params.chatId);

    if (chatId === null) {
        return <InvalidGroup reason="This group link is not valid." />;
    }
    return <GroupPanel chatId={chatId} />;
}

function GroupPanel({ chatId }: { chatId: number }): React.ReactElement {
    const queryClient = useQueryClient();
    const currentUserId = useCurrentUserId();
    const infoQuery = useGroupInfo(chatId);

    const [searchInput, setSearchInput] = useState('');
    const debouncedSearch = useDebouncedValue(searchInput, 300);
    const search =
        debouncedSearch.trim().length > 0 ? debouncedSearch.trim() : '';
    const membersQuery = useGroupMembers(chatId, search);

    const promote = usePromoteMember(chatId);
    const demote = useDemoteMember(chatId);
    const remove = useRemoveMember(chatId);
    const deleteAvatar = useDeleteGroupAvatar(chatId);
    const setMainAvatar = useSetMainGroupAvatar(chatId);

    const [actionTarget, setActionTarget] = useState<GroupMember | null>(null);
    const [permissionsTarget, setPermissionsTarget] =
        useState<GroupMember | null>(null);
    const [pendingMemberId, setPendingMemberId] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const settingsNavRef = useRef(false);

    /** One push for one tap; the settings screen is not opened twice. */
    const openSettings = (): void => {
        if (settingsNavRef.current) return;
        settingsNavRef.current = true;
        router.push(`/(app)/group-settings/${chatId}`);
        setTimeout((): void => {
            settingsNavRef.current = false;
        }, 700);
    };

    useGroupChangedEvents(chatId);
    useGroupUpdatedEvents();
    useRefetchGroupOnFocus(infoQuery.refetch, membersQuery.refetch);

    const handleRemoved = useCallback((): void => {
        purgeChatFromCaches(queryClient, chatId);
        Alert.alert('Removed from group', 'You were removed from this group');
        router.replace('/(app)');
    }, [queryClient, chatId]);
    useGroupRemovedEvent(chatId, handleRemoved);

    useEffect((): (() => void) => {
        return (): void => {
            if (noticeTimer.current !== null) {
                clearTimeout(noticeTimer.current);
            }
        };
    }, []);

    const showNotice = (text: string): void => {
        setNotice(text);
        if (noticeTimer.current !== null) {
            clearTimeout(noticeTimer.current);
        }
        noticeTimer.current = setTimeout(
            (): void => setNotice(null),
            NOTICE_MS,
        );
    };

    const info = infoQuery.data;
    const members = useMemo(
        () => membersQuery.data?.pages.flatMap((page) => page.items) ?? [],
        [membersQuery.data],
    );

    const viewerAvatars = useMemo(
        () => groupAvatarItems(info?.avatars),
        [info?.avatars],
    );

    const runAction = (
        action: ManageMemberAction,
        member: GroupMember,
    ): void => {
        setActionTarget(null);
        setPendingMemberId(member.memberId);
        const mutation =
            action === 'promote'
                ? promote
                : action === 'demote'
                  ? demote
                  : remove;
        mutation
            .mutateAsync(member.memberId)
            .then((result): void => {
                if (!result.changed) {
                    showNotice('No change needed');
                } else if (action === 'promote') {
                    showNotice(`${member.name || 'Member'} is now an admin`);
                } else if (action === 'demote') {
                    showNotice(`${member.name || 'Member'} is now a member`);
                } else {
                    showNotice(`${member.name || 'Member'} was removed`);
                }
            })
            .catch((error: unknown): void => {
                Alert.alert(
                    'Could not update member',
                    describeMemberActionError(error),
                );
            })
            .finally((): void => setPendingMemberId(null));
    };

    const confirmAction = (
        action: ManageMemberAction,
        member: GroupMember,
    ): void => {
        const name = member.name || member.username || 'This member';
        if (action === 'promote') {
            Alert.alert(
                `Make ${name} an admin?`,
                'They will be able to manage members according to their permissions.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Make admin',
                        onPress: (): void => runAction(action, member),
                    },
                ],
            );
            return;
        }
        if (action === 'demote') {
            Alert.alert(
                `Remove ${name} as admin?`,
                'They will become a regular member.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Remove admin',
                        style: 'destructive',
                        onPress: (): void => runAction(action, member),
                    },
                ],
            );
            return;
        }
        Alert.alert(
            `Remove ${name} from this group?`,
            'They can be added again later.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: (): void => runAction(action, member),
                },
            ],
        );
    };

    if (infoQuery.isPending) {
        return <LoadingBlock label="Loading group info…" />;
    }

    if (infoQuery.isError || info === undefined) {
        const error = infoQuery.error;
        const privateChat =
            error instanceof ApiError && error.statusCode === 400;
        return (
            <InvalidGroup
                reason={
                    privateChat
                        ? 'This screen is only available for groups.'
                        : error instanceof ApiError && error.statusCode === 403
                          ? "You don't have access to this group."
                          : 'Could not load this group.'
                }
                {...(privateChat
                    ? {}
                    : {
                          onRetry: (): void => {
                              void infoQuery.refetch();
                          },
                      })}
            />
        );
    }

    const photoActions = groupPhotoActions(info.capabilities.canEditInfo);

    const handleSetMainPhoto = async (fileName: string): Promise<boolean> => {
        try {
            const result = await setMainAvatar.mutateAsync(fileName);
            return result.changed;
        } catch (error) {
            Alert.alert(
                'Could not set group photo',
                describeGroupAvatarError(error),
            );
            return false;
        }
    };

    const handleDeletePhoto = async (fileName: string): Promise<void> => {
        try {
            await deleteAvatar.mutateAsync(fileName);
            setNotice('Group photo deleted');
        } catch (error) {
            Alert.alert(
                'Could not delete group photo',
                describeGroupAvatarError(error),
            );
        }
    };

    const header = (
        <View>
            <View style={styles.identityBlock}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open group photo"
                    accessibilityState={{
                        disabled: viewerAvatars.length === 0,
                    }}
                    disabled={viewerAvatars.length === 0}
                    onPress={(): void => setViewerIndex(0)}
                >
                    <UserAvatar
                        userId={chatId}
                        name={info.title || 'Group'}
                        uri={info.avatars[0] ?? null}
                        size={256}
                    />
                </Pressable>
                <Text style={styles.title} numberOfLines={2}>
                    {info.title || 'Unnamed group'}
                </Text>
                {info.description !== null &&
                    info.description.trim() !== '' && (
                        <Text style={styles.description}>
                            {info.description}
                        </Text>
                    )}
                <Text style={styles.meta}>
                    {info.membersCount} member
                    {info.membersCount === 1 ? '' : 's'}
                </Text>
                {info.owner !== null && (
                    <Text style={styles.ownerLine} numberOfLines={1}>
                        Created by{' '}
                        {info.owner.name || info.owner.username || 'Unknown'}
                    </Text>
                )}
            </View>

            {groupHasPhotoGallery(viewerAvatars.length) && (
                <View style={styles.galleryBlock}>
                    <AvatarGallery
                        avatars={viewerAvatars}
                        readOnly={true}
                        maxAvatars={0}
                        subject="Group photo"
                        onPressAvatar={(index): void => setViewerIndex(index)}
                    />
                </View>
            )}

            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Members</Text>
            </View>
            <TextInput
                value={searchInput}
                onChangeText={setSearchInput}
                placeholder="Search members"
                placeholderTextColor={palette.neutral[500]}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search members"
                style={styles.search}
            />
            {notice !== null && (
                <Text style={styles.notice} accessibilityLiveRegion="polite">
                    {notice}
                </Text>
            )}
        </View>
    );

    const listError =
        membersQuery.isError && members.length === 0
            ? describeMemberActionError(membersQuery.error)
            : null;

    return (
        <View style={styles.root}>
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
                    Group info
                </Text>
                {canOpenGroupSettings(info.myRole) ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Group settings"
                        style={styles.iconButton}
                        onPress={openSettings}
                    >
                        <Text style={styles.gearGlyph}>⚙</Text>
                    </Pressable>
                ) : (
                    <View style={styles.topBarSpacer} />
                )}
            </View>

            <FlatList
                data={members}
                keyExtractor={(item): string => String(item.memberId)}
                renderItem={({ item }: ListRenderItemInfo<GroupMember>) => (
                    <MemberRow
                        member={item}
                        isSelf={
                            currentUserId !== null &&
                            item.userId === currentUserId
                        }
                        pending={pendingMemberId === item.memberId}
                        onOpenProfile={(): void => {
                            openUserProfile({
                                userId: item.userId,
                                name: item.name,
                                avatar: item.avatars[0] ?? null,
                                isSelf:
                                    currentUserId !== null &&
                                    item.userId === currentUserId,
                            });
                        }}
                        onOpenActions={(): void => setActionTarget(item)}
                    />
                )}
                ListHeaderComponent={header}
                ListEmptyComponent={
                    membersQuery.isPending ? (
                        <View style={styles.listState}>
                            <ActivityIndicator
                                size="small"
                                color={palette.primary[500]}
                            />
                        </View>
                    ) : listError !== null ? (
                        <View style={styles.listState}>
                            <Text style={styles.stateTitle}>
                                Could not load members
                            </Text>
                            <Text style={styles.stateDetail}>{listError}</Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry loading members"
                                style={styles.retryButton}
                                onPress={(): void => {
                                    void membersQuery.refetch();
                                }}
                            >
                                <Text style={styles.retryText}>Retry</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.listState}>
                            <Text style={styles.stateTitle}>
                                No members found
                            </Text>
                        </View>
                    )
                }
                ListFooterComponent={
                    membersQuery.isFetchingNextPage ? (
                        <View style={styles.footer}>
                            <ActivityIndicator
                                size="small"
                                color={palette.primary[500]}
                            />
                        </View>
                    ) : undefined
                }
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl
                        refreshing={
                            membersQuery.isRefetching &&
                            !membersQuery.isFetchingNextPage
                        }
                        onRefresh={(): void => {
                            void infoQuery.refetch();
                            void membersQuery.refetch();
                        }}
                        tintColor={palette.primary[500]}
                    />
                }
                onEndReached={(): void => {
                    if (
                        membersQuery.hasNextPage &&
                        !membersQuery.isFetchingNextPage
                    ) {
                        void membersQuery.fetchNextPage();
                    }
                }}
                onEndReachedThreshold={0.4}
                keyboardShouldPersistTaps="handled"
            />

            <MemberActionsSheet
                visible={actionTarget !== null}
                memberName={
                    actionTarget?.name || actionTarget?.username || 'Member'
                }
                actions={
                    actionTarget?.actions ?? {
                        canPromote: false,
                        canDemote: false,
                        canRemove: false,
                        canEditPermissions: false,
                    }
                }
                busy={pendingMemberId !== null}
                onClose={(): void => setActionTarget(null)}
                onAction={(action): void => {
                    if (actionTarget === null) return;
                    if (action === 'permissions') {
                        const member = actionTarget;
                        setActionTarget(null);
                        setPermissionsTarget(member);
                        return;
                    }
                    confirmAction(action, actionTarget);
                }}
            />

            <MemberPermissionsSheet
                visible={permissionsTarget !== null}
                chatId={chatId}
                member={permissionsTarget}
                onClose={(): void => setPermissionsTarget(null)}
                onSaved={(message): void => {
                    setPermissionsTarget(null);
                    showNotice(message);
                }}
                onStale={(message): void => {
                    setPermissionsTarget(null);
                    showNotice(message);
                    void membersQuery.refetch();
                }}
            />

            <AvatarViewer
                visible={viewerIndex !== null}
                avatars={viewerAvatars}
                initialIndex={viewerIndex ?? 0}
                readOnly={photoActions.viewerReadOnly}
                busy={deleteAvatar.isPending || setMainAvatar.isPending}
                pendingFileName={
                    (deleteAvatar.isPending ? deleteAvatar.variables : null) ??
                    (setMainAvatar.isPending ? setMainAvatar.variables : null)
                }
                subject="Group photo"
                setMainLabel="Set as group photo"
                deleteLabel="Delete"
                deleteConfirmTitle="Delete this group photo?"
                deleteConfirmMessage="It will be removed for everyone in the group."
                onClose={(): void => setViewerIndex(null)}
                {...(photoActions.canSetMain
                    ? { onSetMain: handleSetMainPhoto }
                    : {})}
                {...(photoActions.canDelete
                    ? { onDelete: handleDeletePhoto }
                    : {})}
            />
        </View>
    );
}

function MemberRow(props: {
    member: GroupMember;
    isSelf: boolean;
    pending: boolean;
    onOpenProfile: () => void;
    onOpenActions: () => void;
}): React.ReactElement {
    const member = props.member;
    const badge = roleBadgeLabel(member.role);
    const actionsVisible = hasMemberActions(member.actions) && !props.pending;
    const name = member.name || member.username || 'Member';

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name}${
                badge === null ? '' : `, ${badge}`
            }${props.isSelf ? ', you' : ''}`}
            accessibilityState={{ disabled: props.pending }}
            disabled={props.pending}
            onPress={props.onOpenProfile}
            style={({ pressed }) => [
                styles.row,
                pressed && !props.pending && styles.rowPressed,
            ]}
        >
            <View>
                <UserAvatar
                    userId={member.userId}
                    name={name}
                    uri={member.avatars[0] ?? null}
                    size={40}
                />
                {member.isOnline && (
                    <View
                        accessible={true}
                        accessibilityLabel="Online"
                        style={styles.onlineDot}
                    />
                )}
            </View>
            <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>
                    {name}
                </Text>
                {member.username !== '' && (
                    <Text style={styles.rowUsername} numberOfLines={1}>
                        @{member.username}
                    </Text>
                )}
            </View>
            {badge !== null && (
                <View
                    style={[
                        styles.badge,
                        badge === 'Owner' && styles.ownerBadge,
                    ]}
                >
                    <Text
                        style={[
                            styles.badgeText,
                            badge === 'Owner' && styles.ownerBadgeText,
                        ]}
                    >
                        {badge}
                    </Text>
                </View>
            )}
            {props.pending ? (
                <View style={styles.actionButton}>
                    <ActivityIndicator
                        size="small"
                        color={palette.primary[500]}
                    />
                </View>
            ) : actionsVisible ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Member actions"
                    style={({ pressed }) => [
                        styles.actionButton,
                        pressed && styles.rowPressed,
                    ]}
                    onPress={props.onOpenActions}
                >
                    <Text style={styles.actionGlyph}>⋯</Text>
                </Pressable>
            ) : null}
        </Pressable>
    );
}

function LoadingBlock({ label }: { label: string }): React.ReactElement {
    return (
        <View style={styles.centered}>
            <ActivityIndicator size="large" color={palette.primary[500]} />
            <AppText variant="caption" style={styles.centeredCaption}>
                {label}
            </AppText>
        </View>
    );
}

function InvalidGroup(props: {
    reason: string;
    onRetry?: () => void;
}): React.ReactElement {
    return (
        <View style={styles.centered}>
            <AppText variant="title">Group info unavailable</AppText>
            <AppText variant="caption" style={styles.centeredCaption}>
                {props.reason}
            </AppText>
            {props.onRetry !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading group info"
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
    root: {
        flex: 1,
        backgroundColor: palette.neutral[50],
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.neutral[100],
        backgroundColor: palette.neutral[0],
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: {
        fontSize: 32,
        lineHeight: 34,
        color: palette.neutral[900],
    },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    topBarSpacer: { width: 44 },
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
    listContent: {
        paddingBottom: spacing.xl,
    },
    identityBlock: {
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.lg,
        paddingHorizontal: spacing.md,
        backgroundColor: palette.neutral[0],
    },
    galleryBlock: {
        paddingVertical: spacing.sm,
        backgroundColor: palette.neutral[0],
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.neutral[100],
    },
    title: {
        ...typography.title,
        textAlign: 'center',
        marginTop: spacing.xs,
    },
    meta: {
        ...typography.body,
        color: palette.neutral[500],
    },
    ownerLine: {
        ...typography.caption,
        textAlign: 'center',
    },
    description: {
        ...typography.body,
        textAlign: 'center',
        paddingHorizontal: spacing.md,
    },
    sectionHeader: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
        paddingBottom: spacing.xs,
    },
    sectionTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    search: {
        marginHorizontal: spacing.md,
        marginBottom: spacing.xs,
        minHeight: 44,
        borderRadius: radii.md,
        backgroundColor: palette.neutral[0],
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.neutral[300],
        paddingHorizontal: spacing.sm,
        fontSize: 15,
        color: palette.neutral[900],
    },
    notice: {
        ...typography.caption,
        color: palette.semantic.success,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xxs,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 64,
        paddingHorizontal: spacing.md,
        backgroundColor: palette.neutral[0],
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.neutral[100],
    },
    rowPressed: { backgroundColor: palette.neutral[100] },
    rowBody: { flex: 1, gap: 2 },
    rowName: {
        fontSize: 16,
        fontWeight: '600',
        color: palette.neutral[900],
    },
    rowUsername: { ...typography.caption },
    onlineDot: {
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 11,
        height: 11,
        borderRadius: radii.full,
        backgroundColor: palette.semantic.success,
        borderWidth: 2,
        borderColor: palette.neutral[0],
    },
    badge: {
        borderRadius: radii.sm,
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        backgroundColor: palette.neutral[100],
    },
    ownerBadge: { backgroundColor: palette.primary[100] },
    badgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: palette.neutral[700],
    },
    ownerBadgeText: { color: palette.primary[700] },
    actionButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.full,
    },
    actionGlyph: {
        fontSize: 22,
        lineHeight: 24,
        color: palette.neutral[700],
    },
    listState: {
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
    stateDetail: {
        ...typography.caption,
        textAlign: 'center',
    },
    footer: { paddingVertical: spacing.md, alignItems: 'center' },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.lg,
        backgroundColor: palette.neutral[50],
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
        color: palette.neutral[0],
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
