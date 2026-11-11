import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, radii, spacing, typography } from '../../shared/theme';
import {
    GroupMemberActions,
    memberActionLabel,
    visibleMemberActions,
} from './group-model';
import type { GroupMemberAction } from './group-model';

/**
 * Bottom sheet listing ONLY the actions the server permitted for this row.
 * No disabled rows: a member never sees the trigger, and the owner sees no
 * action on themselves or on another owner.
 */
export function MemberActionsSheet(props: {
    visible: boolean;
    memberName: string;
    actions: GroupMemberActions;
    busy: boolean;
    onClose: () => void;
    onAction: (action: GroupMemberAction) => void;
}): React.ReactElement {
    const insets = useSafeAreaInsets();
    const visibleActions = visibleMemberActions(props.actions);

    return (
        <Modal
            visible={props.visible}
            transparent={true}
            animationType="slide"
            statusBarTranslucent={true}
            onRequestClose={props.onClose}
        >
            <Pressable style={styles.backdrop} onPress={props.onClose}>
                <Pressable
                    accessibilityViewIsModal={true}
                    style={[
                        styles.sheet,
                        { paddingBottom: Math.max(insets.bottom, spacing.md) },
                    ]}
                >
                    <Text style={styles.title} numberOfLines={1}>
                        {props.memberName}
                    </Text>
                    <View style={styles.divider} />

                    {visibleActions.map((action) => (
                        <Pressable
                            key={action}
                            accessibilityRole="button"
                            accessibilityLabel={memberActionLabel(action)}
                            accessibilityState={{ disabled: props.busy }}
                            disabled={props.busy}
                            onPress={(): void => props.onAction(action)}
                            style={({ pressed }) => [
                                styles.row,
                                pressed && !props.busy && styles.rowPressed,
                                props.busy && styles.rowDisabled,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.rowLabel,
                                    action === 'remove' && styles.rowDanger,
                                ]}
                            >
                                {memberActionLabel(action)}
                            </Text>
                        </Pressable>
                    ))}

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                        style={styles.cancel}
                        onPress={props.onClose}
                    >
                        <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
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
        paddingTop: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderTopLeftRadius: radii.lg,
        borderTopRightRadius: radii.lg,
        backgroundColor: palette.neutral[0],
    },
    title: {
        ...typography.caption,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xs,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: spacing.xs,
        backgroundColor: palette.neutral[100],
    },
    row: {
        minHeight: 52,
        justifyContent: 'center',
        paddingHorizontal: spacing.xs,
        borderRadius: radii.sm,
    },
    rowPressed: { backgroundColor: palette.neutral[100] },
    rowDisabled: { opacity: 0.45 },
    rowLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: palette.neutral[900],
    },
    rowDanger: { color: palette.semantic.danger },
    cancel: {
        minHeight: 48,
        marginTop: spacing.xxs,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
    },
    cancelText: {
        fontSize: 15,
        fontWeight: '600',
        color: palette.neutral[500],
    },
});
