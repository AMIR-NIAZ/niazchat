import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../core/api';
import {
    UserAvatar,
    palette,
    radii,
    spacing,
    typography,
} from '../../shared/components';
import type {
    GroupMember,
    MemberPermissionKey,
    MemberPermissionOption,
} from './group-model';
import {
    permissionDescription,
    permissionSetEquals,
    togglePermissionSelection,
} from './group-model';
import { describePermissionsError } from './group-errors';
import { useMemberPermissions, useSetMemberPermissions } from './use-group';

/**
 * Owner-only permission editor for one admin. The server returns the editable
 * options and the effective grant set (an `all` grant reads as all three).
 * Toggles are local until Save; a refetch never overwrites unsaved edits.
 */
export function MemberPermissionsSheet(props: {
    visible: boolean;
    chatId: number;
    member: GroupMember | null;
    onClose: () => void;
    onSaved: (message: string) => void;
    onStale: (message: string) => void;
}): React.ReactElement {
    const insets = useSafeAreaInsets();
    const memberId = props.member?.memberId ?? null;
    const memberName = props.member?.name || props.member?.username || 'Admin';
    const query = useMemberPermissions(
        props.chatId,
        memberId ?? 0,
        props.visible && memberId !== null,
    );
    const mutation = useSetMemberPermissions(props.chatId, memberId ?? 0);

    const [selected, setSelected] = useState<MemberPermissionKey[]>([]);
    const [baseline, setBaseline] = useState<MemberPermissionKey[]>([]);
    const [touched, setTouched] = useState(false);
    const [changedElsewhere, setChangedElsewhere] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect((): void => {
        setSelected([]);
        setBaseline([]);
        setTouched(false);
        setChangedElsewhere(false);
        setSaveError(null);
    }, [memberId, props.visible]);

    useEffect((): void => {
        if (query.data === undefined) return;
        if (!touched) {
            setSelected(query.data.granted);
            setBaseline(query.data.granted);
            setChangedElsewhere(false);
            return;
        }
        setChangedElsewhere(
            (current) =>
                current || !permissionSetEquals(query.data.granted, baseline),
        );
    }, [query.data, touched, baseline]);

    const dirty = !permissionSetEquals(selected, baseline);
    const saving = mutation.isPending;

    const requestClose = (): void => {
        if (saving) return;
        if (!dirty) {
            props.onClose();
            return;
        }
        Alert.alert('Discard changes?', 'Your changes will not be saved.', [
            { text: 'Keep editing', style: 'cancel' },
            {
                text: 'Discard',
                style: 'destructive',
                onPress: props.onClose,
            },
        ]);
    };

    const save = (): void => {
        if (!dirty || saving || memberId === null) return;
        setSaveError(null);
        mutation.mutate(selected, {
            onSuccess: (result): void => {
                props.onSaved(
                    result.changed
                        ? `${memberName}'s permissions were updated`
                        : 'No changes needed',
                );
            },
            onError: (error): void => {
                if (
                    error instanceof ApiError &&
                    (error.statusCode === 404 || error.statusCode === 409)
                ) {
                    props.onStale(describePermissionsError(error));
                    return;
                }
                setSaveError(describePermissionsError(error));
            },
        });
    };

    const toggle = (key: MemberPermissionKey): void => {
        setTouched(true);
        setSaveError(null);
        setSelected((current) => togglePermissionSelection(current, key));
    };

    return (
        <Modal
            visible={props.visible && props.member !== null}
            transparent={true}
            animationType="slide"
            statusBarTranslucent={true}
            onRequestClose={requestClose}
        >
            <Pressable style={styles.backdrop} onPress={requestClose}>
                <Pressable
                    accessibilityViewIsModal={true}
                    style={[
                        styles.sheet,
                        {
                            paddingBottom: Math.max(insets.bottom, spacing.md),
                        },
                    ]}
                >
                    <Text style={styles.title} numberOfLines={2}>
                        Permissions of {memberName}
                    </Text>

                    <View style={styles.identity}>
                        <UserAvatar
                            userId={props.member?.userId ?? 0}
                            name={memberName}
                            uri={props.member?.avatars[0] ?? null}
                            size={36}
                        />
                        <View style={styles.identityText}>
                            <Text style={styles.identityName} numberOfLines={1}>
                                {memberName}
                            </Text>
                            {props.member?.username !== undefined &&
                            props.member.username !== '' ? (
                                <Text
                                    style={styles.identityUsername}
                                    numberOfLines={1}
                                >
                                    @{props.member.username}
                                </Text>
                            ) : null}
                        </View>
                    </View>

                    <View style={styles.divider} />

                    {query.isPending ? (
                        <View style={styles.state}>
                            <ActivityIndicator
                                size="small"
                                color={palette.primary[500]}
                            />
                            <Text style={styles.stateText}>
                                Loading permissions…
                            </Text>
                        </View>
                    ) : query.isError ? (
                        <View style={styles.state}>
                            <Text style={styles.errorText}>
                                {describePermissionsError(query.error)}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry loading permissions"
                                style={styles.retry}
                                onPress={(): void => {
                                    void query.refetch();
                                }}
                            >
                                <Text style={styles.retryText}>Retry</Text>
                            </Pressable>
                        </View>
                    ) : query.data !== undefined ? (
                        <View>
                            {query.data.hasAll ? (
                                <Text style={styles.note}>
                                    This admin had full access. Saving converts
                                    it to the permissions selected here.
                                </Text>
                            ) : null}

                            {query.data.available.map(
                                (option: MemberPermissionOption) => {
                                    const checked = selected.includes(
                                        option.key,
                                    );
                                    const description = permissionDescription(
                                        option.key,
                                    );
                                    return (
                                        <View
                                            key={option.key}
                                            style={styles.permissionRow}
                                        >
                                            <View style={styles.permissionText}>
                                                <Text style={styles.label}>
                                                    {option.label}
                                                </Text>
                                                <Text
                                                    style={styles.description}
                                                >
                                                    {description}
                                                </Text>
                                            </View>
                                            <Switch
                                                value={checked}
                                                disabled={saving}
                                                accessibilityLabel={`${option.label}: ${description}`}
                                                accessibilityState={{
                                                    checked,
                                                    disabled: saving,
                                                }}
                                                onValueChange={(): void =>
                                                    toggle(option.key)
                                                }
                                                trackColor={{
                                                    false: palette.neutral[300],
                                                    true: palette.primary[500],
                                                }}
                                                thumbColor={palette.neutral[0]}
                                            />
                                        </View>
                                    );
                                },
                            )}

                            {changedElsewhere && dirty ? (
                                <Text style={styles.warning}>
                                    Permissions changed elsewhere. Saving will
                                    overwrite them.
                                </Text>
                            ) : null}
                            {saveError !== null ? (
                                <Text style={styles.errorText}>
                                    {saveError}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}

                    <View style={styles.footer}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel"
                            accessibilityState={{ disabled: saving }}
                            disabled={saving}
                            style={styles.cancel}
                            onPress={requestClose}
                        >
                            <Text style={styles.cancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Save permissions"
                            accessibilityState={{
                                disabled: !dirty || saving,
                            }}
                            disabled={!dirty || saving}
                            style={[
                                styles.save,
                                (!dirty || saving) && styles.saveDisabled,
                            ]}
                            onPress={save}
                        >
                            {saving ? (
                                <ActivityIndicator
                                    size="small"
                                    color={palette.text.onAccent}
                                />
                            ) : (
                                <Text style={styles.saveText}>Save</Text>
                            )}
                        </Pressable>
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheet: {
        maxHeight: '92%',
        paddingTop: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderTopLeftRadius: radii.lg,
        borderTopRightRadius: radii.lg,
        backgroundColor: palette.elevated,
    },
    title: {
        ...typography.title,
        paddingHorizontal: spacing.xs,
        paddingBottom: spacing.xs,
    },
    identity: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.xs,
        paddingBottom: spacing.xs,
    },
    identityText: { flex: 1, gap: 1 },
    identityName: {
        fontSize: 16,
        fontWeight: '600',
        color: palette.neutral[900],
    },
    identityUsername: { ...typography.caption },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: spacing.xs,
        backgroundColor: palette.neutral[100],
    },
    state: {
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.lg,
        paddingHorizontal: spacing.md,
    },
    stateText: { ...typography.caption },
    note: {
        ...typography.caption,
        marginHorizontal: spacing.xs,
        marginTop: spacing.xs,
    },
    permissionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 64,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.neutral[100],
    },
    permissionText: { flex: 1, gap: 2 },
    label: {
        fontSize: 16,
        fontWeight: '600',
        color: palette.neutral[900],
    },
    description: {
        ...typography.caption,
        color: palette.neutral[500],
    },
    warning: {
        ...typography.caption,
        color: palette.semantic.warning,
        paddingHorizontal: spacing.xs,
        paddingTop: spacing.xs,
    },
    errorText: {
        ...typography.caption,
        color: palette.semantic.danger,
        paddingHorizontal: spacing.xs,
        paddingTop: spacing.xs,
    },
    retry: {
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
    footer: {
        flexDirection: 'row',
        gap: spacing.sm,
        paddingTop: spacing.sm,
    },
    cancel: {
        flex: 1,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
        backgroundColor: palette.neutral[100],
    },
    cancelText: {
        fontSize: 15,
        fontWeight: '600',
        color: palette.neutral[700],
    },
    save: {
        flex: 1,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
        backgroundColor: palette.primary[500],
    },
    saveDisabled: { opacity: 0.45 },
    saveText: {
        color: palette.text.onAccent,
        fontSize: 15,
        fontWeight: '700',
    },
});
