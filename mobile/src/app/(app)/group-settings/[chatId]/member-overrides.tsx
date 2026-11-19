import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../../../core/api';
import { dialog, toast } from '../../../../shared/dialog';
import {
    Screen,
    palette,
    radii,
    spacing,
    typography,
} from '../../../../shared/components';
import type {
    MemberPermissionOverrideMap,
    MemberPermissionOverrideState,
} from '../../../../features/groups/group-model';
import {
    GROUP_MEMBER_PERMISSION_META,
    GROUP_MEMBER_PERMISSION_SECTIONS,
    MEMBER_PERMISSION_OVERRIDE_STATES,
    memberPermissionOverrideLabel,
} from '../../../../features/groups/permissions';
import type { GroupMemberPermissionKey } from '../../../../features/groups/permissions';
import {
    useGroupChangedEvents,
    useGroupInfo,
    useMemberPermissionOverrides,
    useMemberPermissionOverridesEvents,
    useResetMemberPermissionOverrides,
    useUpdateMemberPermissionOverrides,
} from '../../../../features/groups/use-group';

/**
 * Individual member override editor
 * (`/group-settings/:chatId/member-overrides`).
 *
 * Three states per permission — Inherit / Allow / Deny — resolved by the
 * backend as `override ?? groupDefault`. Only the owner or an admin with
 * `manage_permissions` sees working controls; every save is re-authorized and
 * the effective policy is enforced at each operation boundary.
 */

type RouteParams = {
    chatId?: string | string[];
    memberId?: string | string[];
    name?: string | string[];
};

function parsePositiveInt(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseName(value: string | string[] | undefined): string {
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : 'Member';
}

const ACTION_BAR_HEIGHT = 82;

export default function MemberOverridesScreen(): React.ReactElement {
    const params = useLocalSearchParams<RouteParams>();
    const chatId = parsePositiveInt(params.chatId);
    const memberId = parsePositiveInt(params.memberId);
    const memberName = parseName(params.name);

    if (chatId === null || memberId === null) {
        return (
            <Screen withBottomInset={false} style={styles.screen}>
                <TopBar
                    memberName={memberName}
                    onBack={(): void => router.back()}
                />
                <StateBlock
                    title="Member permissions"
                    detail="This link is not valid."
                />
            </Screen>
        );
    }
    return (
        <MemberOverridesPanel
            chatId={chatId}
            memberId={memberId}
            memberName={memberName}
        />
    );
}

function MemberOverridesPanel(props: {
    chatId: number;
    memberId: number;
    memberName: string;
}): React.ReactElement {
    const { chatId, memberId, memberName } = props;
    const insets = useSafeAreaInsets();
    const infoQuery = useGroupInfo(chatId);
    const overridesQuery = useMemberPermissionOverrides(chatId, memberId);
    const updateOverrides = useUpdateMemberPermissionOverrides(
        chatId,
        memberId,
    );
    const resetOverrides = useResetMemberPermissionOverrides(chatId, memberId);

    useGroupChangedEvents(chatId);
    useMemberPermissionOverridesEvents(chatId, memberId);

    const saving = updateOverrides.isPending || resetOverrides.isPending;
    const data = overridesQuery.data;
    const info = infoQuery.data;
    const canEdit =
        data?.canEdit === true &&
        (info === undefined ||
            info.capabilities.canManageMemberPermissions === true);

    const [draft, setDraft] = useState<MemberPermissionOverrideMap | null>(
        null,
    );
    const [baseline, setBaseline] =
        useState<MemberPermissionOverrideMap | null>(null);
    const [touched, setTouched] = useState(false);

    // Seed the editor once; while the user has local edits, a background
    // refetch (focus/realtime) updates only the baseline.
    useEffect((): void => {
        if (data === undefined) return;
        if (!touched) {
            setDraft({ ...data.overrides });
        }
        setBaseline({ ...data.overrides });
    }, [data, touched]);

    // Leave if the caller loses the capability while the screen is open.
    const previousAllowed = useRef<boolean | null>(null);
    useEffect((): void => {
        if (data === undefined) return;
        const allowed = data.canEdit === true;
        const previous = previousAllowed.current;
        previousAllowed.current = allowed;
        if (previous === true && !allowed) {
            toast.show('You can no longer manage member permissions');
            router.back();
        }
    }, [data]);

    useFocusEffect(
        useCallback((): void => {
            void infoQuery.refetch();
            void overridesQuery.refetch();
        }, [infoQuery.refetch, overridesQuery.refetch]),
    );

    const dirty =
        draft !== null &&
        baseline !== null &&
        (Object.keys(draft) as GroupMemberPermissionKey[]).some(
            (key) => draft[key] !== baseline[key],
        );

    const setState = (
        key: GroupMemberPermissionKey,
        state: MemberPermissionOverrideState,
    ): void => {
        if (saving) return;
        setTouched(true);
        setDraft((current) =>
            current === null ? current : { ...current, [key]: state },
        );
    };

    const discard = (): void => {
        if (saving || baseline === null) return;
        setDraft({ ...baseline });
        setTouched(false);
    };

    const save = (): void => {
        if (!dirty || draft === null || baseline === null || saving) return;
        const patch: Partial<
            Record<GroupMemberPermissionKey, MemberPermissionOverrideState>
        > = {};
        for (const key of Object.keys(draft) as GroupMemberPermissionKey[]) {
            if (draft[key] !== baseline[key]) patch[key] = draft[key];
        }
        updateOverrides.mutate(patch, {
            onSuccess: (result): void => {
                setDraft({ ...result.overrides });
                setBaseline({ ...result.overrides });
                setTouched(false);
                toast.show(
                    result.changed
                        ? 'Member permissions updated'
                        : 'No changes needed',
                    { tone: 'success' },
                );
            },
            onError: (error): void => {
                showSaveError(error);
            },
        });
    };

    const confirmReset = (): void => {
        if (saving) return;
        void dialog
            .confirm({
                title: 'Reset to group defaults?',
                message: `Every permission for ${memberName} goes back to the group default.`,
                tone: 'warning',
                confirmText: 'Reset',
                destructive: true,
            })
            .then((confirmed): void => {
                if (!confirmed) return;
                resetOverrides.mutate(undefined, {
                    onSuccess: (result): void => {
                        setDraft({ ...result.overrides });
                        setBaseline({ ...result.overrides });
                        setTouched(false);
                        toast.show('Reset to group defaults', {
                            tone: 'success',
                        });
                    },
                    onError: (error): void => {
                        showSaveError(error);
                    },
                });
            });
    };

    let body: React.ReactElement;
    if (infoQuery.isPending || overridesQuery.isPending) {
        body = <LoadingState memberName={memberName} />;
    } else if (infoQuery.isError || info === undefined) {
        body = (
            <StateBlock
                title="Member permissions unavailable"
                detail="Could not load this group."
                onRetry={(): void => {
                    void infoQuery.refetch();
                }}
            />
        );
    } else if (canEdit !== true) {
        body = (
            <StateBlock
                title="Member permissions"
                detail="Only the group owner or an admin with permission can change what this member can do."
            />
        );
    } else if (overridesQuery.isError || data === undefined) {
        body = (
            <StateBlock
                title="Could not load permissions"
                detail={describeError(overridesQuery.error)}
                onRetry={(): void => {
                    void overridesQuery.refetch();
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
                <Text style={styles.headerTitle}>
                    Permissions for {memberName}
                </Text>
                <Text style={styles.headerCaption}>
                    Inherit uses the group default. Allow or Deny overrides it
                    for this member only. The server applies the effective value
                    to every action.
                </Text>
                <View style={styles.legendRow}>
                    <LegendPill state="inherit" />
                    <LegendPill state="allow" />
                    <LegendPill state="deny" />
                </View>

                {GROUP_MEMBER_PERMISSION_SECTIONS.map((section) => (
                    <View key={section.key} style={styles.section}>
                        <Text style={styles.sectionLabel}>{section.title}</Text>
                        <View style={styles.card}>
                            {section.permissions.map((key, index) => (
                                <OverrideRow
                                    key={key}
                                    permissionKey={key}
                                    value={draft?.[key] ?? 'inherit'}
                                    groupDefault={
                                        data.groupPermissions[key] === true
                                    }
                                    effective={data.effective[key] === true}
                                    disabled={saving}
                                    divider={index > 0}
                                    onChange={(state): void =>
                                        setState(key, state)
                                    }
                                />
                            ))}
                        </View>
                    </View>
                ))}

                <View style={styles.resetCard}>
                    <Text style={styles.resetTitle}>
                        Reset to group defaults
                    </Text>
                    <Text style={styles.resetDetail}>
                        Removes every override for this member.
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Reset to group defaults"
                        accessibilityState={{ disabled: saving }}
                        disabled={saving}
                        onPress={confirmReset}
                        style={({ pressed }) => [
                            styles.resetButton,
                            pressed && !saving && styles.buttonPressed,
                            saving && styles.buttonDisabled,
                        ]}
                    >
                        <Text style={styles.resetButtonText}>
                            Reset all overrides
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        );
    }

    return (
        <Screen withBottomInset={false} style={styles.screen}>
            <TopBar
                memberName={memberName}
                onBack={(): void => router.back()}
            />
            {body}
            {canEdit === true && draft !== null && (
                <View
                    style={[
                        styles.actionBar,
                        { paddingBottom: insets.bottom + spacing.sm },
                    ]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Discard changes"
                        accessibilityState={{ disabled: !dirty || saving }}
                        disabled={!dirty || saving}
                        onPress={discard}
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            (!dirty || saving) && styles.buttonDisabled,
                            pressed && dirty && !saving && styles.buttonPressed,
                        ]}
                    >
                        <Text style={styles.secondaryText}>Discard</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Save member permissions"
                        accessibilityState={{ disabled: !dirty || saving }}
                        disabled={!dirty || saving}
                        onPress={save}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            (!dirty || saving) && styles.buttonDisabled,
                            pressed && dirty && !saving && styles.buttonPressed,
                        ]}
                    >
                        {saving ? (
                            <ActivityIndicator
                                size="small"
                                color={palette.text.onAccent}
                            />
                        ) : (
                            <Text style={styles.primaryText}>Save changes</Text>
                        )}
                    </Pressable>
                </View>
            )}
        </Screen>
    );
}

function OverrideRow(props: {
    permissionKey: GroupMemberPermissionKey;
    value: MemberPermissionOverrideState;
    groupDefault: boolean;
    effective: boolean;
    disabled: boolean;
    divider: boolean;
    onChange: (state: MemberPermissionOverrideState) => void;
}): React.ReactElement {
    const meta = GROUP_MEMBER_PERMISSION_META[props.permissionKey];
    const reason =
        props.value === 'inherit'
            ? props.groupDefault
                ? 'Group default allows this'
                : 'Group default denies this'
            : props.value === 'allow'
              ? 'Explicitly allowed for this member'
              : 'Explicitly denied for this member';
    return (
        <View style={[styles.row, props.divider && styles.rowDivider]}>
            <View style={styles.rowHeader}>
                <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{meta.title}</Text>
                    <Text style={styles.rowDescription}>
                        {meta.description}
                    </Text>
                </View>
                <View
                    style={[
                        styles.effectiveBadge,
                        props.effective
                            ? styles.effectiveAllowed
                            : styles.effectiveDenied,
                    ]}
                >
                    <Text
                        style={[
                            styles.effectiveText,
                            props.effective
                                ? styles.effectiveTextAllowed
                                : styles.effectiveTextDenied,
                        ]}
                    >
                        {props.effective ? 'Allowed' : 'Denied'}
                    </Text>
                </View>
            </View>
            <Text style={styles.rowReason}>{reason}</Text>
            <View style={styles.segmented}>
                {MEMBER_PERMISSION_OVERRIDE_STATES.map((state) => {
                    const selected = props.value === state;
                    return (
                        <Pressable
                            key={state}
                            accessibilityRole="button"
                            accessibilityLabel={`${meta.title}: ${memberPermissionOverrideLabel(state)}`}
                            accessibilityState={{
                                selected,
                                disabled: props.disabled,
                            }}
                            disabled={props.disabled}
                            onPress={(): void => props.onChange(state)}
                            style={({ pressed }) => [
                                styles.segment,
                                selected && styles.segmentSelected,
                                state === 'allow' &&
                                    selected &&
                                    styles.segmentAllow,
                                state === 'deny' &&
                                    selected &&
                                    styles.segmentDeny,
                                pressed &&
                                    !props.disabled &&
                                    styles.segmentPressed,
                                props.disabled && styles.buttonDisabled,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.segmentText,
                                    selected && styles.segmentTextSelected,
                                ]}
                            >
                                {memberPermissionOverrideLabel(state)}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

function LegendPill(props: {
    state: MemberPermissionOverrideState;
}): React.ReactElement {
    return (
        <View
            style={[
                styles.legendPill,
                props.state === 'allow' && styles.legendAllow,
                props.state === 'deny' && styles.legendDeny,
            ]}
        >
            <Text style={styles.legendText}>
                {memberPermissionOverrideLabel(props.state)}
            </Text>
        </View>
    );
}

function TopBar(props: {
    memberName: string;
    onBack: () => void;
}): React.ReactElement {
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
            <View style={styles.topBarTitles}>
                <Text style={styles.topBarTitle} numberOfLines={1}>
                    Member permissions
                </Text>
                <Text style={styles.topBarSubtitle} numberOfLines={1}>
                    {props.memberName}
                </Text>
            </View>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function LoadingState(props: { memberName: string }): React.ReactElement {
    return (
        <View style={styles.centered}>
            <ActivityIndicator size="large" color={palette.primary[500]} />
            <Text style={styles.caption}>
                Loading permissions for {props.memberName}…
            </Text>
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
            {props.onRetry !== undefined && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry"
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

function describeError(error: unknown): string {
    return error instanceof ApiError && error.message !== ''
        ? error.message
        : 'Please try again.';
}

function showSaveError(error: unknown): void {
    dialog.show({
        title: 'Could not save permissions',
        message: describeError(error),
        tone: 'danger',
    });
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.background },
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
    backText: { fontSize: 32, lineHeight: 34, color: palette.neutral[900] },
    topBarTitles: { flex: 1, alignItems: 'center' },
    topBarTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    topBarSubtitle: {
        marginTop: 1,
        fontSize: 12,
        color: palette.neutral[500],
    },
    topBarSpacer: { width: 44 },
    scroll: { flex: 1 },
    scrollContent: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
    },
    headerTitle: {
        ...typography.title,
        color: palette.neutral[900],
        marginBottom: spacing.xxs,
    },
    headerCaption: {
        ...typography.caption,
        color: palette.neutral[500],
        lineHeight: 19,
    },
    legendRow: {
        flexDirection: 'row',
        gap: spacing.xxs,
        marginTop: spacing.sm,
        marginBottom: spacing.xs,
    },
    legendPill: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: radii.full,
        backgroundColor: palette.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.subtle,
    },
    legendAllow: {
        backgroundColor: 'rgba(124, 58, 237, 0.16)',
        borderColor: palette.primary[500],
    },
    legendDeny: {
        backgroundColor: 'rgba(248, 113, 113, 0.14)',
        borderColor: palette.semantic.danger,
    },
    legendText: {
        fontSize: 11,
        fontWeight: '700',
        color: palette.neutral[300],
    },
    section: { marginTop: spacing.md },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: palette.neutral[500],
        marginBottom: spacing.xs,
        marginLeft: spacing.xxs,
    },
    card: {
        borderRadius: radii.lg,
        backgroundColor: palette.surface,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.subtle,
    },
    row: { padding: spacing.md },
    rowDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.border.subtle,
    },
    rowHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
    },
    rowBody: { flex: 1 },
    rowTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: palette.neutral[900],
    },
    rowDescription: {
        marginTop: 2,
        fontSize: 12,
        lineHeight: 17,
        color: palette.neutral[500],
    },
    rowReason: {
        marginTop: spacing.xxs,
        fontSize: 11,
        fontStyle: 'italic',
        color: palette.neutral[500],
    },
    effectiveBadge: {
        paddingHorizontal: spacing.xs,
        paddingVertical: 3,
        borderRadius: radii.full,
        borderWidth: StyleSheet.hairlineWidth,
    },
    effectiveAllowed: {
        backgroundColor: 'rgba(124, 58, 237, 0.14)',
        borderColor: 'rgba(124, 58, 237, 0.5)',
    },
    effectiveDenied: {
        backgroundColor: 'rgba(248, 113, 113, 0.12)',
        borderColor: 'rgba(248, 113, 113, 0.45)',
    },
    effectiveText: { fontSize: 10, fontWeight: '700' },
    effectiveTextAllowed: { color: palette.primary[300] },
    effectiveTextDenied: { color: palette.semantic.danger },
    segmented: {
        flexDirection: 'row',
        marginTop: spacing.sm,
        padding: 3,
        borderRadius: radii.md,
        backgroundColor: palette.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.subtle,
    },
    segment: {
        flex: 1,
        minHeight: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
    },
    segmentSelected: { backgroundColor: palette.surface },
    segmentAllow: { backgroundColor: 'rgba(124, 58, 237, 0.22)' },
    segmentDeny: { backgroundColor: 'rgba(248, 113, 113, 0.18)' },
    segmentPressed: { opacity: 0.7 },
    segmentText: {
        fontSize: 12,
        fontWeight: '600',
        color: palette.neutral[500],
    },
    segmentTextSelected: { color: palette.neutral[900] },
    resetCard: {
        marginTop: spacing.lg,
        padding: spacing.md,
        borderRadius: radii.lg,
        backgroundColor: palette.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.subtle,
    },
    resetTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: palette.neutral[900],
    },
    resetDetail: {
        marginTop: 2,
        fontSize: 12,
        color: palette.neutral[500],
    },
    resetButton: {
        marginTop: spacing.sm,
        minHeight: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.semantic.danger,
    },
    resetButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: palette.semantic.danger,
    },
    actionBar: {
        flexDirection: 'row',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.border.subtle,
        backgroundColor: palette.surface,
    },
    secondaryButton: {
        flex: 1,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.subtle,
    },
    secondaryText: {
        fontSize: 14,
        fontWeight: '600',
        color: palette.neutral[700],
    },
    primaryButton: {
        flex: 2,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.md,
        backgroundColor: palette.primary[500],
    },
    primaryText: {
        fontSize: 14,
        fontWeight: '700',
        color: palette.text.onAccent,
    },
    buttonDisabled: { opacity: 0.45 },
    buttonPressed: { opacity: 0.8 },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.lg,
    },
    caption: {
        marginTop: spacing.sm,
        fontSize: 13,
        color: palette.neutral[500],
        textAlign: 'center',
    },
    stateTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: palette.neutral[900],
        textAlign: 'center',
    },
    stateDetail: {
        marginTop: spacing.xxs,
        fontSize: 13,
        lineHeight: 19,
        color: palette.neutral[500],
        textAlign: 'center',
    },
    retryButton: {
        marginTop: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.xs,
        borderRadius: radii.md,
        backgroundColor: palette.primary[500],
    },
    retryText: {
        fontSize: 13,
        fontWeight: '700',
        color: palette.text.onAccent,
    },
    backLink: { marginTop: spacing.sm, padding: spacing.xs },
    backLinkText: {
        fontSize: 13,
        fontWeight: '600',
        color: palette.neutral[500],
    },
});
