import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../../../core/api';
import { dialog, toast } from '../../../../shared/dialog';
import {
    SafeText,
    Screen,
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
    AppText,
} from '../../../../shared/components';
import type {
    GroupMember,
    MemberPermissionKey,
} from '../../../../features/groups/group-model';
import { describePermissionsError } from '../../../../features/groups/group-errors';
import {
    GROUP_PERMISSIONS,
    PERMISSION_META,
    PERMISSION_PRESETS,
    impliedBy,
    isPermissionEffective,
    permissionSetEquals,
} from '../../../../features/groups/permissions';
import type { GroupPermissionKey } from '../../../../features/groups/permissions';
import {
    useGroupChangedEvents,
    useGroupInfo,
    useGroupMembers,
    useMemberPermissions,
    usePromoteMember,
    useSetMemberPermissions,
} from '../../../../features/groups/use-group';
import { useTheme, useThemedStyles } from '../../../../shared/theme';
import type { AppTheme } from '../../../../shared/theme';

/**
 * Admin permissions editor (`/group-settings/:chatId/admin-permissions`).
 *
 * A full screen (not a sheet): members screen -> ⋯ -> "Edit permissions", or
 * the "Make admin" promote flow with `mode=promote`. Saving in promote mode
 * performs the promotion and the initial grant set in one request; leaving
 * without saving never promotes.
 *
 * The server remains the authority: rows the caller cannot grant are disabled
 * and explain why. The members query cache supplies the profile card instantly;
 * a direct deep link falls back to loading member pages until the target is
 * found.
 */

type RouteParams = {
    chatId?: string | string[];
    userId?: string | string[];
    memberId?: string | string[];
    mode?: string | string[];
};

function parsePositiveInt(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseMode(value: string | string[] | undefined): 'edit' | 'promote' {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw === 'promote' ? 'promote' : 'edit';
}

interface PermissionSection {
    title: string;
    keys: readonly MemberPermissionKey[];
}

/** Presentational grouping only; the permission list itself is unchanged. */
const PERMISSION_SECTIONS: readonly PermissionSection[] = [
    {
        title: 'Group',
        keys: ['edit_group_info', 'manage_members', 'manage_invites'],
    },
    {
        title: 'Members',
        keys: ['remove_members', 'ban_users', 'restrict_members'],
    },
    {
        title: 'Messages',
        keys: [
            'pin_messages',
            'delete_other_messages',
            'manage_messages',
            'manage_voice_chats',
        ],
    },
    {
        title: 'Admins',
        keys: ['manage_admins', 'manage_permissions'],
    },
];

/** Sticky action bar height without the safe-area inset. */
const ACTION_BAR_HEIGHT = 76;

export default function AdminPermissionsScreen(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const params = useLocalSearchParams<RouteParams>();
    const chatId = parsePositiveInt(params.chatId);
    const userId = parsePositiveInt(params.userId);
    const memberId = parsePositiveInt(params.memberId);
    const mode = parseMode(params.mode);

    if (chatId === null || userId === null) {
        return (
            <Screen withBottomInset={false} style={styles.screen}>
                <TopBar onBack={(): void => router.back()} />
                <StateBlock
                    title="Admin permissions"
                    detail="This link is not valid."
                />
            </Screen>
        );
    }

    return (
        <AdminPermissionsPanel
            chatId={chatId}
            userId={userId}
            memberId={memberId}
            mode={mode}
        />
    );
}

function AdminPermissionsPanel(props: {
    chatId: number;
    userId: number;
    memberId: number | null;
    mode: 'edit' | 'promote';
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const { chatId, userId, mode } = props;
    const isPromote = mode === 'promote';
    const insets = useSafeAreaInsets();

    const infoQuery = useGroupInfo(chatId);
    // Same query key as the members screen, so the member is instant when the
    // editor is opened from that list. A deep link fills pages until found.
    const membersQuery = useGroupMembers(chatId, '');
    const member = useMemo<GroupMember | null>(() => {
        const pages = membersQuery.data?.pages;
        if (pages === undefined) return null;
        return (
            pages
                .flatMap((page) => page.items)
                .find((item) => item.userId === userId) ?? null
        );
    }, [membersQuery.data, userId]);

    const targetMemberId = member?.memberId ?? props.memberId;
    const permissionsQuery = useMemberPermissions(
        chatId,
        targetMemberId ?? 0,
        !isPromote && targetMemberId !== null,
    );

    const setPermissions = useSetMemberPermissions(chatId, targetMemberId ?? 0);
    const promote = usePromoteMember(chatId);
    const saving = setPermissions.isPending || promote.isPending;

    useGroupChangedEvents(chatId);

    // Cached member data renders instantly; focus refreshes it in the
    // background so a direct deep link still converges on current data.
    useFocusEffect(
        useCallback((): void => {
            void infoQuery.refetch();
            void membersQuery.refetch();
        }, [infoQuery.refetch, membersQuery.refetch]),
    );

    const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
        membersQuery;
    useEffect((): void => {
        if (member !== null || !hasNextPage || isFetchingNextPage) return;
        void fetchNextPage();
    }, [member, hasNextPage, isFetchingNextPage, fetchNextPage]);

    const [selected, setSelected] = useState<MemberPermissionKey[]>([]);
    const [baseline, setBaseline] = useState<MemberPermissionKey[]>([]);
    const [touched, setTouched] = useState(false);

    useEffect((): void => {
        if (isPromote || permissionsQuery.data === undefined || touched) return;
        setSelected(permissionsQuery.data.granted);
        setBaseline(permissionsQuery.data.granted);
    }, [permissionsQuery.data, touched, isPromote]);

    const info = infoQuery.data;
    const callerRole = info?.myRole ?? null;
    const grantable = useMemo<GroupPermissionKey[]>(() => {
        if (callerRole === 'owner') {
            return [...GROUP_PERMISSIONS];
        }
        if (!isPromote && permissionsQuery.data !== undefined) {
            return permissionsQuery.data.grantable;
        }
        // Promote mode has no editor endpoint yet: derive the preview from the
        // capabilities the group info already computes for the caller.
        const capabilities = info?.capabilities;
        if (capabilities === undefined) return [];
        const map: Array<[GroupPermissionKey, boolean | undefined]> = [
            ['edit_group_info', capabilities.canEditInfo],
            ['manage_members', capabilities.canManageMembers],
            ['remove_members', capabilities.canRemoveMembers],
            ['ban_users', capabilities.canManageBans],
            [
                'manage_invites',
                capabilities.canManageInvites ??
                    capabilities.canManageInviteLinks,
            ],
            ['pin_messages', capabilities.canPinMessages],
            ['delete_other_messages', capabilities.canDeleteOthersMessages],
            [
                'manage_messages',
                capabilities.canDeleteOthersMessages &&
                    capabilities.canPinMessages,
            ],
            ['restrict_members', capabilities.canRestrictMembers],
            ['manage_voice_chats', capabilities.canManageVoiceChats],
            ['manage_admins', capabilities.canManageAdmins],
            ['manage_permissions', capabilities.canManagePermissions],
        ];
        return map
            .filter(([, allowed]) => allowed === true)
            .map(([key]) => key);
    }, [callerRole, isPromote, permissionsQuery.data, info]);

    const grantableSet = useMemo(() => new Set(grantable), [grantable]);
    const dirty = isPromote
        ? selected.length > 0 || touched
        : !permissionSetEquals(selected, baseline);

    const allowed =
        info !== undefined &&
        (info.myRole === 'owner' ||
            (isPromote
                ? info.capabilities.canManageAdmins === true
                : info.capabilities.canManagePermissions === true));

    const previousAllowed = useRef<boolean | null>(null);
    useEffect((): void => {
        if (info === undefined) return;
        const previous = previousAllowed.current;
        previousAllowed.current = allowed;
        if (previous === true && !allowed) {
            toast.show('You can no longer manage admin permissions');
            router.back();
        }
    }, [info, allowed]);

    const dirtyRef = useRef(dirty);
    const savingRef = useRef(saving);
    dirtyRef.current = dirty;
    savingRef.current = saving;

    const requestClose = useCallback((): void => {
        if (savingRef.current) return;
        if (!dirtyRef.current) {
            router.back();
            return;
        }
        void dialog
            .confirm({
                title: 'Discard changes?',
                message: 'Your changes will not be saved.',
                confirmText: 'Discard',
                cancelText: 'Keep editing',
                destructive: true,
            })
            .then((confirmed): void => {
                if (confirmed) router.back();
            });
    }, []);

    // Android hardware back goes through the same unsaved-changes check.
    useFocusEffect(
        useCallback((): (() => void) => {
            const subscription = BackHandler.addEventListener(
                'hardwareBackPress',
                (): boolean => {
                    if (!dirtyRef.current) return false;
                    requestClose();
                    return true;
                },
            );
            return (): void => subscription.remove();
        }, [requestClose]),
    );

    const applyPreset = (permissions: GroupPermissionKey[]): void => {
        setTouched(true);
        setSelected(permissions.filter((key) => grantableSet.has(key)));
    };

    const toggle = (key: GroupPermissionKey): void => {
        if (!grantableSet.has(key)) return;
        setTouched(true);
        setSelected((current) =>
            current.includes(key)
                ? current.filter((value) => value !== key)
                : [...current, key],
        );
    };

    const reset = (): void => {
        if (saving) return;
        setSelected(baseline);
        setTouched(false);
    };

    const memberName =
        member?.name || member?.username || (isPromote ? 'Member' : 'Admin');

    const onSaveError = (error: unknown): void => {
        if (
            error instanceof ApiError &&
            (error.statusCode === 404 || error.statusCode === 409)
        ) {
            dialog.show({
                title: 'Admin permissions changed',
                message: describePermissionsError(error),
                tone: 'warning',
            });
            void permissionsQuery.refetch();
            void refetch();
            return;
        }
        dialog.show({
            title: isPromote
                ? 'Could not promote member'
                : 'Could not save permissions',
            message: describePermissionsError(error),
            tone: 'danger',
        });
    };

    const save = (): void => {
        if (saving || targetMemberId === null) return;
        if (!isPromote && !dirty) return;
        if (isPromote) {
            promote.mutate(
                { memberId: targetMemberId, permissions: selected },
                {
                    onSuccess: (result): void => {
                        toast.show(
                            result.changed
                                ? `${memberName} is now an admin`
                                : 'No change needed',
                            { tone: 'success' },
                        );
                        router.back();
                    },
                    onError: onSaveError,
                },
            );
            return;
        }
        setPermissions.mutate(selected, {
            onSuccess: (result): void => {
                setBaseline(result.granted);
                setSelected(result.granted);
                toast.show(
                    result.changed
                        ? 'Permissions updated'
                        : 'No changes needed',
                    { tone: 'success' },
                );
                router.back();
            },
            onError: onSaveError,
        });
    };

    const saveDisabled = isPromote
        ? saving || !dirty
        : saving ||
          !dirty ||
          permissionsQuery.isPending ||
          permissionsQuery.isError;

    const lookingForMember =
        member === null &&
        (membersQuery.isPending ||
            (membersQuery.hasNextPage && membersQuery.isFetchingNextPage));

    let body: React.ReactElement;
    if (infoQuery.isPending) {
        body = <LoadingSkeleton />;
    } else if (infoQuery.isError || info === undefined) {
        body = (
            <StateBlock
                title="Admin permissions unavailable"
                detail={describeLoadError(infoQuery.error)}
                onRetry={(): void => {
                    void infoQuery.refetch();
                }}
            />
        );
    } else if (!allowed) {
        body = (
            <StateBlock
                title="Admin permissions"
                detail="You don't have permission to manage admin permissions in this group."
            />
        );
    } else if (lookingForMember) {
        body = <LoadingSkeleton />;
    } else if (member === null) {
        body = (
            <StateBlock
                title="Member not found"
                detail="This person is no longer in the group."
                onRetry={(): void => {
                    void refetch();
                }}
            />
        );
    } else if (!isPromote && permissionsQuery.isPending) {
        body = <LoadingSkeleton />;
    } else if (!isPromote && permissionsQuery.isError) {
        body = (
            <StateBlock
                title="Could not load permissions"
                detail={describePermissionsError(permissionsQuery.error)}
                onRetry={(): void => {
                    void permissionsQuery.refetch();
                }}
            />
        );
    } else {
        body = (
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[
                    styles.scrollContent,
                    {
                        paddingBottom:
                            ACTION_BAR_HEIGHT + insets.bottom + spacing.lg,
                    },
                ]}
            >
                <ProfileCard
                    member={member}
                    isPromote={isPromote}
                    hasAll={permissionsQuery.data?.hasAll === true}
                />

                <AppText style={styles.sectionLabel}>Presets</AppText>
                <View style={styles.presets}>
                    {PERMISSION_PRESETS.map((preset) => (
                        <Pressable
                            key={preset.key}
                            accessibilityRole="button"
                            accessibilityLabel={`${preset.label} preset`}
                            disabled={saving}
                            onPress={(): void =>
                                applyPreset(preset.permissions)
                            }
                            style={({ pressed }) => [
                                styles.preset,
                                pressed && !saving && styles.presetPressed,
                            ]}
                        >
                            <AppText style={styles.presetText}>
                                {preset.label}
                            </AppText>
                        </Pressable>
                    ))}
                </View>

                {PERMISSION_SECTIONS.map((section) => (
                    <View key={section.title}>
                        <AppText style={styles.groupLabel}>{section.title}</AppText>
                        {section.keys.map((key) => (
                            <PermissionRow
                                key={key}
                                permissionKey={key}
                                selected={selected}
                                grantableSet={grantableSet}
                                saving={saving}
                                onToggle={toggle}
                            />
                        ))}
                    </View>
                ))}
            </ScrollView>
        );
    }

    return (
        <Screen withBottomInset={false} style={styles.screen}>
            <TopBar onBack={requestClose} />
            {body}
            <View
                style={[
                    styles.actionBar,
                    { paddingBottom: Math.max(insets.bottom, spacing.sm) },
                ]}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Reset changes"
                    accessibilityState={{ disabled: saving || !dirty }}
                    disabled={saving || !dirty}
                    style={({ pressed }) => [
                        styles.reset,
                        (saving || !dirty) && styles.buttonDisabled,
                        pressed && !saving && styles.resetPressed,
                    ]}
                    onPress={reset}
                >
                    <AppText style={styles.resetText}>Reset</AppText>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        isPromote ? 'Make admin' : 'Save permissions'
                    }
                    accessibilityState={{ disabled: saveDisabled }}
                    disabled={saveDisabled}
                    style={({ pressed }) => [
                        styles.save,
                        saveDisabled && styles.buttonDisabled,
                        pressed && !saveDisabled && styles.savePressed,
                    ]}
                    onPress={save}
                >
                    {saving ? (
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.accentText}
                        />
                    ) : (
                        <AppText style={styles.saveText}>
                            {isPromote ? 'Make admin' : 'Save'}
                        </AppText>
                    )}
                </Pressable>
            </View>
        </Screen>
    );
}

function ProfileCard(props: {
    member: GroupMember;
    isPromote: boolean;
    hasAll: boolean;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    const name = props.member.name || props.member.username || 'Member';
    return (
        <View style={styles.profileCard}>
            <UserAvatar
                userId={props.member.userId}
                name={name}
                uri={props.member.avatars[0] ?? null}
                size={64}
            />
            <View style={styles.profileText}>
                <SafeText style={styles.profileName} lines={1}>
                    {name}
                </SafeText>
                {props.member.username !== '' ? (
                    <AppText style={styles.profileUsername} numberOfLines={1}>
                        @{props.member.username}
                    </AppText>
                ) : null}
                <View style={styles.roleChip}>
                    <AppText style={styles.roleChipText}>
                        {props.isPromote ? 'New admin' : 'Admin'}
                    </AppText>
                </View>
            </View>
            {props.hasAll ? (
                <AppText style={styles.fullAccessNote}>
                    This admin has full access. Saving converts it to the
                    permissions selected below.
                </AppText>
            ) : null}
        </View>
    );
}

function PermissionRow(props: {
    permissionKey: MemberPermissionKey;
    selected: readonly MemberPermissionKey[];
    grantableSet: ReadonlySet<GroupPermissionKey>;
    saving: boolean;
    onToggle: (key: GroupPermissionKey) => void;
}): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const meta = PERMISSION_META[props.permissionKey];
    const implied = impliedBy(props.permissionKey, props.selected);
    const locked = implied !== null;
    const effective = isPermissionEffective(
        props.permissionKey,
        props.selected,
    );
    const canGrant = props.grantableSet.has(props.permissionKey) || effective;
    const disabled = props.saving || locked || !canGrant;
    const caption = locked
        ? `Included in ${PERMISSION_META[implied].en}`
        : !canGrant
          ? "You don't have this permission"
          : null;

    return (
        <View style={styles.permissionRow}>
            <View style={styles.permissionText}>
                <View style={styles.labelRow}>
                    <AppText style={styles.label}>{meta.en}</AppText>
                    {!meta.active ? (
                        <AppText style={styles.inactive}>Inactive</AppText>
                    ) : null}
                </View>
                <AppText style={styles.persian}>{meta.fa}</AppText>
                <AppText style={styles.description}>{meta.description}</AppText>
                {caption !== null ? (
                    <AppText style={styles.caption}>{caption}</AppText>
                ) : null}
            </View>
            <Switch
                value={effective}
                disabled={disabled}
                accessibilityLabel={`${meta.en}: ${meta.description}`}
                accessibilityState={{ checked: effective, disabled }}
                onValueChange={(): void => props.onToggle(props.permissionKey)}
                trackColor={{
                    false: theme.colors.textMuted,
                    true: theme.accent,
                }}
                thumbColor={theme.colors.background}
            />
        </View>
    );
}

function TopBar(props: { onBack: () => void }): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={props.onBack}
            >
                <AppText style={styles.backText}>‹</AppText>
            </Pressable>
            <AppText style={styles.topBarTitle} numberOfLines={1}>
                Admin permissions
            </AppText>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function LoadingSkeleton(): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.skeletonWrap}>
            <View style={styles.skeletonProfile} />
            {[0, 1, 2, 3].map((index) => (
                <View key={index} style={styles.skeletonRow}>
                    <View style={styles.skeletonLineWide} />
                    <View style={styles.skeletonLine} />
                </View>
            ))}
        </View>
    );
}

function StateBlock(props: {
    title: string;
    detail: string;
    onRetry?: () => void;
}): React.ReactElement {
    const styles = useThemedStyles(createStyles);
    return (
        <View style={styles.centered}>
            <AppText style={styles.stateTitle}>{props.title}</AppText>
            <AppText style={styles.stateDetail}>{props.detail}</AppText>
            {props.onRetry !== undefined ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry"
                    style={styles.retryButton}
                    onPress={props.onRetry}
                >
                    <AppText style={styles.retryText}>Retry</AppText>
                </Pressable>
            ) : null}
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

function describeLoadError(error: Error | null): string {
    const theme = useTheme();
    if (error instanceof ApiError && error.statusCode === 400) {
        return 'This screen is only available for groups.';
    }
    if (error instanceof ApiError && error.statusCode === 403) {
        return "You don't have access to this group.";
    }
    return 'Could not load this group.';
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.glassSurface,
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
        color: theme.colors.text,
    },
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text,
    },
    topBarSpacer: { width: 44 },
    scroll: { flex: 1 },
    scrollContent: {
        paddingTop: spacing.sm,
    },
    profileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: spacing.sm,
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        padding: spacing.md,
        borderRadius: radii.md,
        backgroundColor: theme.colors.glassSurface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
    },
    profileText: { flex: 1, minWidth: 0, gap: 2 },
    profileName: {
        fontSize: 17,
        fontWeight: '700',
        color: theme.colors.text,
    },
    profileUsername: theme.type.caption,
    roleChip: {
        alignSelf: 'flex-start',
        marginTop: spacing.xxs,
        borderRadius: radii.full,
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        backgroundColor: theme.colors.accentSoft,
    },
    roleChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: theme.accent,
    },
    fullAccessNote: {
        ...theme.type.caption,
        width: '100%',
        marginTop: spacing.xxs,
    },
    sectionLabel: {
        ...theme.type.caption,
        fontWeight: '700',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.xs,
        paddingBottom: spacing.xxs,
    },
    presets: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xxs,
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
    },
    preset: {
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xxs,
        backgroundColor: theme.colors.accentSoft,
    },
    presetPressed: { opacity: 0.7 },
    presetText: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.accent,
    },
    groupLabel: {
        ...theme.type.caption,
        fontWeight: '700',
        textTransform: 'uppercase',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        paddingBottom: spacing.xs,
    },
    permissionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 84,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        backgroundColor: theme.colors.glassSurface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
    },
    permissionText: { flex: 1, gap: 1 },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xxs,
    },
    label: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    inactive: {
        fontSize: 10,
        fontWeight: '700',
        textTransform: 'uppercase',
        color: theme.colors.textSecondary,
        backgroundColor: theme.colors.glassElevated,
        borderRadius: radii.sm,
        paddingHorizontal: 6,
        paddingVertical: 1,
        overflow: 'hidden',
    },
    persian: {
        ...theme.type.caption,
        color: theme.colors.textSecondary,
        writingDirection: 'rtl',
        textAlign: 'right',
        alignSelf: 'flex-start',
        width: '100%',
    },
    description: {
        ...theme.type.caption,
        color: theme.colors.textSecondary,
    },
    caption: {
        ...theme.type.caption,
        color: theme.accent,
    },
    actionBar: {
        position: 'absolute',
        start: 0,
        end: 0,
        bottom: 0,
        flexDirection: 'row',
        gap: spacing.sm,
        alignItems: 'center',
        minHeight: ACTION_BAR_HEIGHT,
        paddingTop: spacing.sm,
        paddingHorizontal: spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.glassSurface,
    },
    reset: {
        flex: 1,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
        backgroundColor: theme.colors.glassElevated,
    },
    resetPressed: { opacity: 0.75 },
    resetText: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    save: {
        flex: 2,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
        backgroundColor: theme.accent,
    },
    savePressed: { opacity: 0.85 },
    saveText: {
        color: theme.colors.accentText,
        fontSize: 15,
        fontWeight: '700',
    },
    buttonDisabled: { opacity: 0.45 },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.lg,
    },
    stateTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
        textAlign: 'center',
    },
    stateDetail: {
        ...theme.type.caption,
        textAlign: 'center',
    },
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
    skeletonWrap: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        gap: spacing.sm,
    },
    skeletonProfile: {
        height: 96,
        borderRadius: radii.md,
        backgroundColor: theme.colors.glassSurface,
    },
    skeletonRow: {
        borderRadius: radii.md,
        backgroundColor: theme.colors.glassSurface,
        padding: spacing.md,
        gap: spacing.xs,
    },
    skeletonLine: {
        height: 10,
        width: '55%',
        borderRadius: 5,
        backgroundColor: theme.colors.glassElevated,
    },
    skeletonLineWide: {
        height: 12,
        width: '85%',
        borderRadius: 6,
        backgroundColor: theme.colors.glassElevated,
    },
});
