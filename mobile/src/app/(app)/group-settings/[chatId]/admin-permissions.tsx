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

                <Text style={styles.sectionLabel}>Presets</Text>
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
                            <Text style={styles.presetText}>
                                {preset.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                {PERMISSION_SECTIONS.map((section) => (
                    <View key={section.title}>
                        <Text style={styles.groupLabel}>{section.title}</Text>
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
                    <Text style={styles.resetText}>Reset</Text>
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
                            color={palette.text.onAccent}
                        />
                    ) : (
                        <Text style={styles.saveText}>
                            {isPromote ? 'Make admin' : 'Save'}
                        </Text>
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
                    <Text style={styles.profileUsername} numberOfLines={1}>
                        @{props.member.username}
                    </Text>
                ) : null}
                <View style={styles.roleChip}>
                    <Text style={styles.roleChipText}>
                        {props.isPromote ? 'New admin' : 'Admin'}
                    </Text>
                </View>
            </View>
            {props.hasAll ? (
                <Text style={styles.fullAccessNote}>
                    This admin has full access. Saving converts it to the
                    permissions selected below.
                </Text>
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
                    <Text style={styles.label}>{meta.en}</Text>
                    {!meta.active ? (
                        <Text style={styles.inactive}>Inactive</Text>
                    ) : null}
                </View>
                <Text style={styles.persian}>{meta.fa}</Text>
                <Text style={styles.description}>{meta.description}</Text>
                {caption !== null ? (
                    <Text style={styles.caption}>{caption}</Text>
                ) : null}
            </View>
            <Switch
                value={effective}
                disabled={disabled}
                accessibilityLabel={`${meta.en}: ${meta.description}`}
                accessibilityState={{ checked: effective, disabled }}
                onValueChange={(): void => props.onToggle(props.permissionKey)}
                trackColor={{
                    false: palette.neutral[300],
                    true: palette.primary[500],
                }}
                thumbColor={palette.neutral[0]}
            />
        </View>
    );
}

function TopBar(props: { onBack: () => void }): React.ReactElement {
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={props.onBack}
            >
                <Text style={styles.backText}>‹</Text>
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
                Admin permissions
            </Text>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function LoadingSkeleton(): React.ReactElement {
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
    return (
        <View style={styles.centered}>
            <Text style={styles.stateTitle}>{props.title}</Text>
            <Text style={styles.stateDetail}>{props.detail}</Text>
            {props.onRetry !== undefined ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry"
                    style={styles.retryButton}
                    onPress={props.onRetry}
                >
                    <Text style={styles.retryText}>Retry</Text>
                </Pressable>
            ) : null}
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

function describeLoadError(error: Error | null): string {
    if (error instanceof ApiError && error.statusCode === 400) {
        return 'This screen is only available for groups.';
    }
    if (error instanceof ApiError && error.statusCode === 403) {
        return "You don't have access to this group.";
    }
    return 'Could not load this group.';
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: palette.background,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.border.subtle,
        backgroundColor: palette.surface,
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
        backgroundColor: palette.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.subtle,
    },
    profileText: { flex: 1, minWidth: 0, gap: 2 },
    profileName: {
        fontSize: 17,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    profileUsername: typography.caption,
    roleChip: {
        alignSelf: 'flex-start',
        marginTop: spacing.xxs,
        borderRadius: radii.full,
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        backgroundColor: palette.primary[100],
    },
    roleChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: palette.primary[700],
    },
    fullAccessNote: {
        ...typography.caption,
        width: '100%',
        marginTop: spacing.xxs,
    },
    sectionLabel: {
        ...typography.caption,
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
        backgroundColor: palette.primary[100],
    },
    presetPressed: { opacity: 0.7 },
    presetText: {
        fontSize: 13,
        fontWeight: '600',
        color: palette.primary[700],
    },
    groupLabel: {
        ...typography.caption,
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
        backgroundColor: palette.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.border.subtle,
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
        color: palette.neutral[900],
    },
    inactive: {
        fontSize: 10,
        fontWeight: '700',
        textTransform: 'uppercase',
        color: palette.neutral[500],
        backgroundColor: palette.neutral[100],
        borderRadius: radii.sm,
        paddingHorizontal: 6,
        paddingVertical: 1,
        overflow: 'hidden',
    },
    persian: {
        ...typography.caption,
        color: palette.neutral[500],
        writingDirection: 'rtl',
        textAlign: 'right',
        alignSelf: 'flex-start',
        width: '100%',
    },
    description: {
        ...typography.caption,
        color: palette.neutral[500],
    },
    caption: {
        ...typography.caption,
        color: palette.primary[700],
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
        borderTopColor: palette.border.subtle,
        backgroundColor: palette.surface,
    },
    reset: {
        flex: 1,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
        backgroundColor: palette.neutral[100],
    },
    resetPressed: { opacity: 0.75 },
    resetText: {
        fontSize: 15,
        fontWeight: '600',
        color: palette.neutral[700],
    },
    save: {
        flex: 2,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
        backgroundColor: palette.primary[500],
    },
    savePressed: { opacity: 0.85 },
    saveText: {
        color: palette.text.onAccent,
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
        color: palette.neutral[700],
        textAlign: 'center',
    },
    stateDetail: {
        ...typography.caption,
        textAlign: 'center',
    },
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
    skeletonWrap: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        gap: spacing.sm,
    },
    skeletonProfile: {
        height: 96,
        borderRadius: radii.md,
        backgroundColor: palette.surface,
    },
    skeletonRow: {
        borderRadius: radii.md,
        backgroundColor: palette.surface,
        padding: spacing.md,
        gap: spacing.xs,
    },
    skeletonLine: {
        height: 10,
        width: '55%',
        borderRadius: 5,
        backgroundColor: palette.neutral[100],
    },
    skeletonLineWide: {
        height: 12,
        width: '85%',
        borderRadius: 6,
        backgroundColor: palette.neutral[100],
    },
});
