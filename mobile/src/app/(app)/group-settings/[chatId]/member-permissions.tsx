import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
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
    Screen,
    palette,
    radii,
    spacing,
    typography,
} from '../../../../shared/components';
import type { GroupMemberPermissionsConfig } from '../../../../features/groups/group-model';
import {
    GROUP_MEMBER_PERMISSIONS,
    GROUP_MEMBER_PERMISSION_META,
    GROUP_MEMBER_PERMISSION_SECTIONS,
} from '../../../../features/groups/permissions';
import type { GroupMemberPermissionKey } from '../../../../features/groups/permissions';
import {
    useGroupChangedEvents,
    useGroupInfo,
    useGroupMemberPermissions,
    useGroupMemberPermissionsEvents,
    useUpdateGroupMemberPermissions,
} from '../../../../features/groups/use-group';

/**
 * Member permissions editor (`/group-settings/:chatId/member-permissions`).
 *
 * Controls what REGULAR MEMBERS may do in the group (separate from per-admin
 * grants). Only the owner or an admin with `manage_permissions` can open it;
 * the backend re-authorizes every save and enforces each switch at the
 * operation boundary, so this screen is only an editor for the policy.
 */

type RouteParams = { chatId?: string | string[] };

function parseChatId(value: string | string[] | undefined): number | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Sticky action bar height without the safe-area inset. */
const ACTION_BAR_HEIGHT = 76;

export default function MemberPermissionsScreen(): React.ReactElement {
    const params = useLocalSearchParams<RouteParams>();
    const chatId = parseChatId(params.chatId);

    if (chatId === null) {
        return (
            <Screen withBottomInset={false} style={styles.screen}>
                <TopBar onBack={(): void => router.back()} />
                <StateBlock
                    title="Member permissions"
                    detail="This link is not valid."
                />
            </Screen>
        );
    }
    return <MemberPermissionsPanel chatId={chatId} />;
}

function MemberPermissionsPanel({
    chatId,
}: {
    chatId: number;
}): React.ReactElement {
    const insets = useSafeAreaInsets();
    const infoQuery = useGroupInfo(chatId);
    const permissionsQuery = useGroupMemberPermissions(chatId);
    const updatePermissions = useUpdateGroupMemberPermissions(chatId);

    useGroupChangedEvents(chatId);
    useGroupMemberPermissionsEvents(chatId);

    const saving = updatePermissions.isPending;
    const info = infoQuery.data;
    const allowed =
        info === undefined
            ? null
            : info.capabilities.canManageMemberPermissions === true;

    const [draft, setDraft] = useState<GroupMemberPermissionsConfig | null>(
        null,
    );
    const [baseline, setBaseline] =
        useState<GroupMemberPermissionsConfig | null>(null);
    const [touched, setTouched] = useState(false);

    // The server value seeds the editor; once the user touched switches, a
    // background refetch (focus/realtime) never overwrites local edits.
    useEffect((): void => {
        if (permissionsQuery.data === undefined || touched) return;
        setDraft({ ...permissionsQuery.data.permissions });
        setBaseline({ ...permissionsQuery.data.permissions });
    }, [permissionsQuery.data, touched]);

    // Leave if the caller loses the capability while the screen is open.
    const previousAllowed = useRef<boolean | null>(null);
    useEffect((): void => {
        if (allowed === null) return;
        const previous = previousAllowed.current;
        previousAllowed.current = allowed;
        if (previous === true && !allowed) {
            toast.show('You can no longer manage member permissions');
            router.back();
        }
    }, [allowed]);

    // Focus refresh keeps the policy and the role capability current.
    useFocusEffect(
        useCallback((): void => {
            void infoQuery.refetch();
            void permissionsQuery.refetch();
        }, [infoQuery.refetch, permissionsQuery.refetch]),
    );

    // Realtime policy change while the user is editing: refresh the baseline
    // and, when there are no local edits, the visible switches too.
    useEffect((): void => {
        if (permissionsQuery.data === undefined) return;
        const next = permissionsQuery.data.permissions;
        setBaseline((current) => (current === null ? { ...next } : next));
        if (!touched) setDraft({ ...next });
    }, [permissionsQuery.data, touched]);

    const dirty =
        draft !== null &&
        baseline !== null &&
        GROUP_MEMBER_PERMISSIONS.some((key) => draft[key] !== baseline[key]);

    const toggle = (key: GroupMemberPermissionKey): void => {
        if (saving) return;
        setTouched(true);
        setDraft((current) =>
            current === null ? current : { ...current, [key]: !current[key] },
        );
    };

    const reset = (): void => {
        if (saving || baseline === null) return;
        setDraft({ ...baseline });
        setTouched(false);
    };

    const save = (): void => {
        if (!dirty || draft === null || baseline === null || saving) return;
        const patch: Partial<GroupMemberPermissionsConfig> = {};
        for (const key of GROUP_MEMBER_PERMISSIONS) {
            if (draft[key] !== baseline[key]) patch[key] = draft[key];
        }
        updatePermissions.mutate(patch, {
            onSuccess: (result): void => {
                setBaseline({ ...result.permissions });
                setDraft({ ...result.permissions });
                setTouched(false);
                toast.show(
                    result.changed
                        ? 'Member permissions updated'
                        : 'No changes needed',
                    { tone: 'success' },
                );
            },
            onError: (error): void => {
                dialog.show({
                    title: 'Could not save permissions',
                    message:
                        error instanceof ApiError && error.message !== ''
                            ? error.message
                            : 'Please try again.',
                    tone: 'danger',
                });
            },
        });
    };

    let body: React.ReactElement;
    if (
        infoQuery.isPending ||
        (allowed !== false && permissionsQuery.isPending)
    ) {
        body = <LoadingState />;
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
    } else if (allowed !== true) {
        body = (
            <StateBlock
                title="Member permissions"
                detail="Only the group owner or an admin with permission can change what members can do."
            />
        );
    } else if (permissionsQuery.isError) {
        body = (
            <StateBlock
                title="Could not load permissions"
                detail={
                    permissionsQuery.error instanceof ApiError &&
                    permissionsQuery.error.message !== ''
                        ? permissionsQuery.error.message
                        : 'Please try again.'
                }
                onRetry={(): void => {
                    void permissionsQuery.refetch();
                }}
            />
        );
    } else if (draft === null) {
        body = <LoadingState />;
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
                <Text style={styles.headerTitle}>What members can do</Text>
                <Text style={styles.headerCaption}>
                    These switches apply to everyone with the member role.
                    Owners always keep full access and admins follow their own
                    permissions.
                </Text>

                {GROUP_MEMBER_PERMISSION_SECTIONS.map((section) => (
                    <View key={section.key} style={styles.section}>
                        <Text style={styles.sectionLabel}>{section.title}</Text>
                        <View style={styles.card}>
                            {section.permissions.map((key, index) => (
                                <PermissionRow
                                    key={key}
                                    permissionKey={key}
                                    value={draft[key]}
                                    disabled={saving}
                                    divider={index > 0}
                                    onToggle={(): void => toggle(key)}
                                />
                            ))}
                        </View>
                    </View>
                ))}
            </ScrollView>
        );
    }

    return (
        <Screen withBottomInset={false} style={styles.screen}>
            <TopBar onBack={(): void => router.back()} />
            {body}
            {allowed === true && draft !== null && (
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
                        onPress={reset}
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            (!dirty || saving) && styles.buttonDisabled,
                            pressed && dirty && !saving && styles.buttonPressed,
                        ]}
                    >
                        <Text style={styles.secondaryText}>Reset</Text>
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

function PermissionRow(props: {
    permissionKey: GroupMemberPermissionKey;
    value: boolean;
    disabled: boolean;
    divider: boolean;
    onToggle: () => void;
}): React.ReactElement {
    const meta = GROUP_MEMBER_PERMISSION_META[props.permissionKey];
    return (
        <View style={[styles.row, props.divider && styles.rowDivider]}>
            <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{meta.title}</Text>
                <Text style={styles.rowDescription}>{meta.description}</Text>
            </View>
            <Switch
                accessibilityLabel={meta.title}
                accessibilityHint={meta.description}
                value={props.value}
                onValueChange={props.onToggle}
                disabled={props.disabled}
                trackColor={{
                    false: palette.neutral[300],
                    true: palette.primary[500],
                }}
                thumbColor={palette.text.onAccent}
                ios_backgroundColor={palette.neutral[300]}
            />
        </View>
    );
}

function TopBar({ onBack }: { onBack: () => void }): React.ReactElement {
    return (
        <View style={styles.topBar}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
                onPress={onBack}
            >
                <Text style={styles.backText}>‹</Text>
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
                Member permissions
            </Text>
            <View style={styles.topBarSpacer} />
        </View>
    );
}

function LoadingState(): React.ReactElement {
    return (
        <View style={styles.centered}>
            <ActivityIndicator size="large" color={palette.primary[500]} />
            <Text style={styles.caption}>Loading member permissions…</Text>
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
    topBarTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '700',
        color: palette.neutral[900],
    },
    topBarSpacer: { width: 44 },
    scroll: { flex: 1 },
    scrollContent: { paddingTop: spacing.md },
    headerTitle: {
        ...typography.title,
        paddingHorizontal: spacing.md,
    },
    headerCaption: {
        ...typography.caption,
        paddingHorizontal: spacing.md,
        marginTop: spacing.xxs,
        marginBottom: spacing.sm,
    },
    section: { marginTop: spacing.sm },
    sectionLabel: {
        ...typography.caption,
        color: palette.text.muted,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        paddingHorizontal: spacing.md,
        marginBottom: spacing.xs,
    },
    card: {
        marginHorizontal: spacing.md,
        borderRadius: radii.lg,
        backgroundColor: palette.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.subtle,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 72,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    rowDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.border.subtle,
    },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: palette.neutral[900],
    },
    rowDescription: {
        ...typography.caption,
        color: palette.text.muted,
        paddingRight: spacing.xs,
    },
    actionBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        minHeight: ACTION_BAR_HEIGHT,
        flexDirection: 'row',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        backgroundColor: palette.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.border.subtle,
    },
    primaryButton: {
        flex: 1,
        minHeight: 48,
        borderRadius: radii.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[500],
    },
    primaryText: {
        color: palette.text.onAccent,
        fontSize: 15,
        fontWeight: '700',
    },
    secondaryButton: {
        minHeight: 48,
        paddingHorizontal: spacing.md,
        borderRadius: radii.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.primary[100],
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border.subtle,
    },
    secondaryText: {
        color: palette.primary[700],
        fontSize: 15,
        fontWeight: '600',
    },
    buttonDisabled: { opacity: 0.4 },
    buttonPressed: { opacity: 0.85 },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        padding: spacing.lg,
    },
    caption: { ...typography.caption, textAlign: 'center' },
    stateTitle: {
        ...typography.title,
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
        color: palette.primary[600],
    },
});
