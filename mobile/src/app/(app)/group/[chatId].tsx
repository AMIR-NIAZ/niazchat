import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    AppText,
    SafeText,
    UserAvatar,
    radii,
    spacing,
    OfflineCaption,
} from '../../../shared/components';
import { useTheme, useThemedStyles } from '../../../shared/theme';
import type { AppTheme } from '../../../shared/theme';
import { useAfterModalClose } from '../../../shared/hooks/use-after-modal-close';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { dialog, toast } from '../../../shared/dialog';
import { ApiError } from '../../../core/api';
import { useCurrentUserId } from '../../../features/auth';
import { purgeChatFromCaches } from '../../../features/chats';
import {
    AvatarGallery,
    AvatarViewer,
} from '../../../features/users/avatar-gallery';
import { openUserProfile } from '../../../features/users';
import { deleteLocalChatMessages } from '../../../shared/local-db';
import { MemberActionsSheet } from '../../../features/groups/member-actions-sheet';
import {
    canOpenGroupSettings,
    groupHasPhotoGallery,
    groupPhotoActions,
    hasMemberActions,
    permissionSummary,
    roleBadgeLabel,
} from '../../../features/groups/group-model';
import type {
    GroupMember,
    GroupMemberAction,
} from '../../../features/groups/group-model';
import {
    describeMemberActionError,
    groupAvatarItems,
    useBanMember,
    useDeleteGroupAvatar,
    useDemoteMember,
    useGroupChangedEvents,
    useGroupInfo,
    useGroupMembers,
    useGroupRemovedEvent,
    useRefetchGroupOnFocus,
    useRemoveMember,
    useGroupUpdatedEvents,
    useSetMainGroupAvatar,
} from '../../../features/groups/use-group';
import { describeGroupAvatarError } from '../../../features/groups/group-errors';
import { Settings, UserPlus } from 'lucide-react-native';
import { ChatSharedContent } from '../../../features/shared-content';
import type { MembersTabConfig } from '../../../features/shared-content';

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

type ManageMemberAction = Exclude<GroupMemberAction, 'permissions' | 'promote'>;

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
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const queryClient = useQueryClient();
    const currentUserId = useCurrentUserId();
    const infoQuery = useGroupInfo(chatId);

    const [searchInput, setSearchInput] = useState('');
    const debouncedSearch = useDebouncedValue(searchInput, 300);
    const search =
        debouncedSearch.trim().length > 0 ? debouncedSearch.trim() : '';
    const membersQuery = useGroupMembers(chatId, search);

    const demote = useDemoteMember(chatId);
    const remove = useRemoveMember(chatId);
    const ban = useBanMember(chatId);
    const deleteAvatar = useDeleteGroupAvatar(chatId);
    const setMainAvatar = useSetMainGroupAvatar(chatId);

    const [actionTarget, setActionTarget] = useState<GroupMember | null>(null);
    // The sheet's content is driven by the last selected member, so clearing
    // `actionTarget` (which hides the Modal) does not empty the sheet while it
    // slides away.
    const sheetMemberRef = useRef<GroupMember | null>(null);
    if (actionTarget !== null) {
        sheetMemberRef.current = actionTarget;
    }
    const sheetMember = actionTarget ?? sheetMemberRef.current;
    // Ignore repeated taps on an action while the sheet is closing.
    const actionLockRef = useRef(false);
    const { deferUntilDismissed, onModalDismiss } = useAfterModalClose();
    const [pendingMemberId, setPendingMemberId] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const settingsNavRef = useRef(false);
    const addMembersNavRef = useRef(false);

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
        toast.show('You were removed from this group');
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

    const bannedFromGroup =
        infoQuery.error instanceof ApiError &&
        infoQuery.error.statusCode === 403;
    const bannedHandled = useRef(false);

    // A banned viewer keeps no local trace of the group: list row, conversation
    // cache, chat info and mirrored SQLite messages are dropped once.
    useEffect((): void => {
        if (!bannedFromGroup || bannedHandled.current) return;
        bannedHandled.current = true;
        purgeChatFromCaches(queryClient, chatId);
        if (currentUserId !== null) {
            void deleteLocalChatMessages(currentUserId, chatId).catch(
                (): void => undefined,
            );
        }
    }, [bannedFromGroup, queryClient, chatId, currentUserId]);

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
            action === 'demote' ? demote : action === 'ban' ? ban : remove;
        mutation
            .mutateAsync(member.memberId)
            .then((result): void => {
                if (!result.changed) {
                    showNotice('No change needed');
                } else if (action === 'demote') {
                    showNotice(`${member.name || 'Member'} is now a member`);
                } else if (action === 'ban') {
                    showNotice(`${member.name || 'Member'} was banned`);
                } else {
                    showNotice(`${member.name || 'Member'} was removed`);
                }
            })
            .catch((error: unknown): void => {
                dialog.show({
                    title: 'Could not update member',
                    message: describeMemberActionError(error),
                    tone: 'danger',
                });
            })
            .finally((): void => setPendingMemberId(null));
    };

    const confirmAction = (
        action: ManageMemberAction,
        member: GroupMember,
    ): void => {
        const name = member.name || member.username || 'This member';
        if (action === 'demote') {
            void dialog
                .confirm({
                    title: `Remove ${name} as admin?`,
                    message: 'They will become a regular member.',
                    confirmText: 'Remove admin',
                    destructive: true,
                })
                .then((confirmed): void => {
                    if (confirmed) {
                        runAction(action, member);
                    }
                });
            return;
        }
        if (action === 'ban') {
            void dialog
                .confirm({
                    title: `Ban ${name}?`,
                    message:
                        'They will be removed from the group and cannot rejoin until you unban them.',
                    confirmText: 'Ban',
                    destructive: true,
                })
                .then((confirmed): void => {
                    if (confirmed) {
                        runAction(action, member);
                    }
                });
            return;
        }
        void dialog
            .confirm({
                title: `Remove ${name} from this group?`,
                message: 'They can be added again later.',
                confirmText: 'Remove',
                destructive: true,
            })
            .then((confirmed): void => {
                if (confirmed) {
                    runAction(action, member);
                }
            });
    };

    // Cached group info always wins over a pending/failed refetch.
    if (infoQuery.isPending && info === undefined) {
        return <LoadingBlock label="Loading group info…" />;
    }

    if (info === undefined) {
        const error = infoQuery.error;
        const privateChat =
            error instanceof ApiError && error.statusCode === 400;
        const banned = error instanceof ApiError && error.statusCode === 403;
        return (
            <InvalidGroup
                {...(banned ? { title: "You can't access this group" } : {})}
                reason={
                    privateChat
                        ? 'This screen is only available for groups.'
                        : banned
                          ? 'This group is no longer available to you.'
                          : 'Could not load this group.'
                }
                {...(privateChat || banned
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
            dialog.show({
                title: 'Could not set group photo',
                message: describeGroupAvatarError(error),
                tone: 'danger',
            });
            return false;
        }
    };

    const handleDeletePhoto = async (fileName: string): Promise<void> => {
        try {
            await deleteAvatar.mutateAsync(fileName);
            setNotice('Group photo deleted');
        } catch (error) {
            dialog.show({
                title: 'Could not delete group photo',
                message: describeGroupAvatarError(error),
                tone: 'danger',
            });
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
                <SafeText style={styles.title} lines={2}>
                    {info.title || 'Unnamed group'}
                </SafeText>
                {info.description !== null &&
                    info.description.trim() !== '' && (
                        <SafeText lines={0} style={styles.description}>
                            {info.description}
                        </SafeText>
                    )}
                <AppText variant="caption" style={styles.meta}>
                    {info.membersCount} member
                    {info.membersCount === 1 ? '' : 's'}
                </AppText>
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
        </View>
    );

    const listError =
        membersQuery.isError && members.length === 0
            ? describeMemberActionError(membersQuery.error)
            : null;

    // The tab's rows are the existing members UI, virtualized by the shared
    // section's list: toolbar/search first, then one row per member.
    const memberRows: { key: string; node: React.ReactNode }[] = [
        {
            key: 'members-toolbar',
            node: (
                <View>
                    {notice !== null && (
                        <AppText
                            style={styles.notice}
                            accessibilityLiveRegion="polite"
                        >
                            {notice}
                        </AppText>
                    )}
                    <View style={styles.membersToolbar}>
                        <TextInput
                            value={searchInput}
                            onChangeText={setSearchInput}
                            placeholder="Search members"
                            placeholderTextColor={theme.colors.textMuted}
                            autoCorrect={false}
                            returnKeyType="search"
                            accessibilityLabel="Search members"
                            style={styles.search}
                        />
                        {info.capabilities.canAddMembers === true && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Add members"
                                style={({ pressed }) => [
                                    styles.addMembersButton,
                                    pressed && styles.rowPressed,
                                ]}
                                onPress={(): void => {
                                    if (addMembersNavRef.current) return;
                                    addMembersNavRef.current = true;
                                    router.push(
                                        `/(app)/group-settings/${chatId}/add-members`,
                                    );
                                    setTimeout((): void => {
                                        addMembersNavRef.current = false;
                                    }, 700);
                                }}
                            >
                                <UserPlus
                                    size={16}
                                    color={theme.accent}
                                    strokeWidth={2}
                                />
                                <SafeText style={styles.addMembersText}>
                                    Add
                                </SafeText>
                            </Pressable>
                        )}
                    </View>
                </View>
            ),
        },
    ];
    for (const item of members) {
        memberRows.push({
            key: `member-${item.memberId}`,
            node: (
                <MemberRow
                    member={item}
                    isSelf={
                        currentUserId !== null && item.userId === currentUserId
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
                    onOpenActions={(): void => {
                        actionLockRef.current = false;
                        setActionTarget(item);
                    }}
                />
            ),
        });
    }
    if (membersQuery.isPending) {
        memberRows.push({
            key: 'members-loading',
            node: (
                <View style={styles.listState}>
                    <ActivityIndicator size="small" color={theme.accent} />
                </View>
            ),
        });
    }
    if (listError !== null) {
        memberRows.push({
            key: 'members-error',
            node: (
                <View style={styles.listState}>
                    <AppText variant="heading" style={styles.stateTitle}>
                        Could not load members
                    </AppText>
                    <AppText variant="caption" style={styles.stateDetail}>
                        {listError}
                    </AppText>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading members"
                        style={styles.retryButton}
                        onPress={(): void => {
                            void membersQuery.refetch();
                        }}
                    >
                        <SafeText style={styles.retryText}>Retry</SafeText>
                    </Pressable>
                </View>
            ),
        });
    }
    if (!membersQuery.isPending && listError === null && members.length === 0) {
        memberRows.push({
            key: 'members-empty',
            node: (
                <View style={styles.listState}>
                    <AppText variant="heading" style={styles.stateTitle}>
                        No members found
                    </AppText>
                </View>
            ),
        });
    }
    if (membersQuery.hasNextPage && !membersQuery.isFetchingNextPage) {
        memberRows.push({
            key: 'members-load-more',
            node: (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Load more members"
                    style={styles.loadMoreButton}
                    onPress={(): void => {
                        void membersQuery.fetchNextPage();
                    }}
                >
                    <SafeText style={styles.loadMoreText} align="center">
                        Load more members
                    </SafeText>
                </Pressable>
            ),
        });
    }

    const membersTab: MembersTabConfig = {
        rows: memberRows,
        hasNextPage: membersQuery.hasNextPage,
        isFetchingNextPage: membersQuery.isFetchingNextPage,
        isRefetching: membersQuery.isRefetching,
        onLoadMore: (): void => {
            void membersQuery.fetchNextPage();
        },
        onRefresh: (): void => {
            void membersQuery.refetch();
        },
    };

    return (
        <View style={styles.root}>
            <View style={styles.topBar}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    style={styles.backButton}
                    onPress={(): void => router.back()}
                >
                    <SafeText style={styles.backText} align="center">
                        ‹
                    </SafeText>
                </Pressable>
                <SafeText
                    style={styles.topBarTitle}
                    lines={1}
                    align="center"
                >
                    Group info
                </SafeText>
                {canOpenGroupSettings(info.myRole) ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Group settings"
                        style={styles.iconButton}
                        onPress={openSettings}
                    >
                        <Settings
                            size={21}
                            color={theme.colors.text}
                            strokeWidth={1.8}
                        />
                    </Pressable>
                ) : (
                    <View style={styles.topBarSpacer} />
                )}
            </View>

            <OfflineCaption />

            {/* One scroll container for the whole profile: group info scrolls
                as the header, the tab bar pins under the top bar, and the
                active tab's rows (Members first) scroll beneath it. */}
            <ChatSharedContent
                chatId={chatId}
                showSender={true}
                header={header}
                members={membersTab}
            />

            <MemberActionsSheet
                visible={actionTarget !== null}
                memberName={
                    sheetMember?.name || sheetMember?.username || 'Member'
                }
                actions={
                    sheetMember?.actions ?? {
                        canPromote: false,
                        canDemote: false,
                        canRemove: false,
                        canEditPermissions: false,
                        canBan: false,
                        canManageMemberPermissions: false,
                    }
                }
                busy={pendingMemberId !== null}
                onDismiss={onModalDismiss}
                onClose={(): void => {
                    actionLockRef.current = false;
                    setActionTarget(null);
                }}
                onAction={(action): void => {
                    if (actionTarget === null || actionLockRef.current) return;
                    actionLockRef.current = true;
                    if (action === 'member-permissions') {
                        const member = actionTarget;
                        setActionTarget(null);
                        router.push(
                            `/(app)/group-settings/${chatId}/member-overrides?memberId=${member.memberId}&userId=${member.userId}&name=${encodeURIComponent(member.name || member.username || 'Member')}`,
                        );
                        return;
                    }
                    if (action === 'permissions' || action === 'promote') {
                        const member = actionTarget;
                        setActionTarget(null);
                        router.push(
                            `/(app)/group-settings/${chatId}/admin-permissions?userId=${member.userId}&memberId=${member.memberId}&mode=${action === 'promote' ? 'promote' : 'edit'}`,
                        );
                        return;
                    }
                    // Close the sheet first: the shared dialog is an in-tree
                    // overlay, so it would otherwise sit behind this native
                    // Modal (or make the Modal/dialog stack). The captured
                    // member survives the sheet closing.
                    const member = actionTarget;
                    setActionTarget(null);
                    deferUntilDismissed((): void =>
                        confirmAction(action, member),
                    );
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
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
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
                <SafeText style={styles.rowName} lines={1}>
                    {name}
                </SafeText>
                {member.username !== '' && (
                    <SafeText style={styles.rowUsername} lines={1}>
                        @{member.username}
                    </SafeText>
                )}
                {permissionSummary(member.role, member.permissions) !==
                    null && (
                    <SafeText style={styles.rowUsername} lines={1}>
                        {permissionSummary(member.role, member.permissions)}
                    </SafeText>
                )}
            </View>
            {badge !== null && (
                <View
                    style={[
                        styles.badge,
                        badge === 'Owner' && styles.ownerBadge,
                    ]}
                >
                    <SafeText
                        style={[
                            styles.badgeText,
                            badge === 'Owner' && styles.ownerBadgeText,
                        ]}
                    >
                        {badge}
                    </SafeText>
                </View>
            )}
            {props.pending ? (
                <View style={styles.actionButton}>
                    <ActivityIndicator size="small" color={theme.accent} />
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
                    <SafeText style={styles.actionGlyph} align="center">
                        ⋯
                    </SafeText>
                </Pressable>
            ) : null}
        </Pressable>
    );
}

function LoadingBlock({ label }: { label: string }): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.accent} />
            <AppText variant="caption" style={styles.centeredCaption}>
                {label}
            </AppText>
        </View>
    );
}

function InvalidGroup(props: {
    title?: string;
    reason: string;
    onRetry?: () => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.centered}>
            <AppText variant="title">
                {props.title ?? 'Group info unavailable'}
            </AppText>
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
                    <SafeText style={styles.retryText}>Retry</SafeText>
                </Pressable>
            )}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backLink}
                onPress={(): void => router.back()}
            >
                <SafeText style={styles.backLinkText}>Go back</SafeText>
            </Pressable>
        </View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        // Transparent canvas: the global background layer shows through.
        root: { flex: 1 },
        // Semi-transparent theme surface, readable over any background.
        topBar: {
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 52,
            paddingHorizontal: spacing.xs,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
            backgroundColor: theme.colors.glassHeader,
            paddingTop: 22,
        },
        backButton: {
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
        },
        backText: {
            ...theme.type.title,
            fontSize: 32,
            lineHeight: 34,
            color: theme.colors.text,
        },
        topBarTitle: {
            ...theme.type.heading,
            flex: 1,
            fontSize: 16,
            textAlign: 'center',
            color: theme.colors.text,
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
            color: theme.colors.textSecondary,
        },
        loadMoreButton: {
            alignSelf: 'center',
            marginVertical: spacing.sm,
            borderWidth: 1,
            borderColor: theme.colors.accentBorder,
            borderRadius: radii.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xxs,
        },
        loadMoreText: {
            ...theme.type.label,
            color: theme.accent,
            textAlign: 'center',
        },
        identityBlock: {
            alignItems: 'center',
            gap: spacing.xs,
            paddingVertical: spacing.lg,
            paddingHorizontal: spacing.md,
        },
        galleryBlock: {
            paddingVertical: spacing.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
        },
        title: {
            ...theme.type.title,
            alignSelf: 'stretch',
            textAlign: 'center',
            marginTop: spacing.xs,
        },
        meta: {
            ...theme.type.caption,
            color: theme.colors.textSecondary,
        },
        ownerLine: {
            ...theme.type.caption,
            textAlign: 'center',
        },
        description: {
            ...theme.type.body,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            paddingHorizontal: spacing.md,
        },
        // Sticky-ish member toolbar: translucent surface, readable over any
        // background while rows scroll beneath it.
        membersToolbar: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: theme.colors.glassHeader,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        addMembersButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minHeight: 34,
            paddingHorizontal: spacing.sm,
            borderRadius: radii.full,
            backgroundColor: theme.colors.accentSoft,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.accentBorder,
        },
        addMembersText: {
            ...theme.type.label,
            color: theme.accent,
        },
        search: {
            flex: 1,
            minHeight: 44,
            borderRadius: radii.md,
            backgroundColor: theme.colors.glassSurface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            paddingHorizontal: spacing.sm,
            ...theme.type.body,
            color: theme.colors.text,
        },
        notice: {
            ...theme.type.caption,
            color: theme.colors.success,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xxs,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            minHeight: 64,
            paddingHorizontal: spacing.md,
            backgroundColor: theme.colors.glassSurface,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
        },
        rowPressed: { backgroundColor: theme.colors.glassElevated },
        rowBody: { flex: 1, minWidth: 0, gap: 2 },
        rowName: {
            ...theme.type.heading,
            fontSize: 16,
            color: theme.colors.text,
        },
        rowUsername: {
            ...theme.type.caption,
            color: theme.colors.textSecondary,
        },
        onlineDot: {
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 11,
            height: 11,
            borderRadius: radii.full,
            backgroundColor: theme.colors.success,
            borderWidth: 2,
            borderColor: theme.colors.background,
        },
        badge: {
            flexShrink: 0,
            borderRadius: radii.sm,
            paddingHorizontal: spacing.xs,
            paddingVertical: 2,
            backgroundColor: theme.colors.glassElevated,
        },
        ownerBadge: { backgroundColor: theme.colors.accentSoft },
        badgeText: {
            ...theme.type.micro,
            fontSize: 11,
            color: theme.colors.textSecondary,
        },
        ownerBadgeText: { color: theme.accent },
        actionButton: {
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radii.full,
        },
        actionGlyph: {
            ...theme.type.heading,
            fontSize: 22,
            lineHeight: 24,
            color: theme.colors.textSecondary,
        },
        listState: {
            alignItems: 'center',
            gap: spacing.xs,
            paddingVertical: spacing.xl,
            paddingHorizontal: spacing.lg,
        },
        stateTitle: {
            ...theme.type.heading,
            fontSize: 16,
            color: theme.colors.text,
            textAlign: 'center',
        },
        stateDetail: {
            ...theme.type.caption,
            color: theme.colors.textSecondary,
            textAlign: 'center',
        },
        centered: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.xs,
            padding: spacing.lg,
        },
        centeredCaption: {
            textAlign: 'center',
            color: theme.colors.textSecondary,
        },
        retryButton: {
            marginTop: spacing.xs,
            borderRadius: radii.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            backgroundColor: theme.accent,
        },
        retryText: {
            ...theme.type.label,
            color: theme.colors.accentText,
            textAlign: 'center',
        },
        backLink: { padding: spacing.sm },
        backLinkText: {
            ...theme.type.label,
            color: theme.accent,
        },
    });
