import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ban } from 'lucide-react-native';
import { radii, spacing } from '../../shared/theme';
import { useTheme, useThemedStyles } from '../../shared/theme/theme-provider';
import type { AppTheme } from '../../shared/theme/theme-provider';
import { SafeText } from '../../shared/components';
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
 *
 * The sheet is a themed elevated surface with scaled text, so light/dark, the
 * accent and the chosen font/text size apply live.
 */
export function MemberActionsSheet(props: {
    visible: boolean;
    memberName: string;
    actions: GroupMemberActions;
    busy: boolean;
    onClose: () => void;
    /** Fires once the sheet has finished dismissing (iOS `Modal.onDismiss`). */
    onDismiss?: () => void;
    onAction: (action: GroupMemberAction) => void;
}): React.ReactElement {
    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const visibleActions = visibleMemberActions(props.actions);

    return (
        <Modal
            visible={props.visible}
            transparent={true}
            animationType="slide"
            statusBarTranslucent={true}
            onRequestClose={props.onClose}
            onDismiss={props.onDismiss}
        >
            <Pressable style={styles.backdrop} onPress={props.onClose}>
                <Pressable
                    accessibilityViewIsModal={true}
                    style={[
                        styles.sheet,
                        { paddingBottom: Math.max(insets.bottom, spacing.md) },
                    ]}
                >
                    <SafeText style={styles.title} lines={1}>
                        {props.memberName}
                    </SafeText>
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
                            {action === 'ban' ? (
                                <View style={styles.dangerRow}>
                                    <Ban
                                        size={18}
                                        color={theme.colors.danger}
                                        strokeWidth={1.8}
                                    />
                                    <SafeText
                                        style={[
                                            styles.rowLabel,
                                            styles.rowDanger,
                                        ]}
                                    >
                                        {memberActionLabel(action)}
                                    </SafeText>
                                </View>
                            ) : (
                                <SafeText
                                    style={[
                                        styles.rowLabel,
                                        action === 'remove' &&
                                            styles.rowDanger,
                                    ]}
                                >
                                    {memberActionLabel(action)}
                                </SafeText>
                            )}
                        </Pressable>
                    ))}

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                        style={({ pressed }) => [
                            styles.cancel,
                            pressed && styles.rowPressed,
                        ]}
                        onPress={props.onClose}
                    >
                        <SafeText style={styles.cancelText} align="center">
                            Cancel
                        </SafeText>
                    </Pressable>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        backdrop: {
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: theme.colors.chatScrim,
        },
        sheet: {
            paddingTop: spacing.sm,
            paddingHorizontal: spacing.sm,
            borderTopLeftRadius: radii.lg,
            borderTopRightRadius: radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.glassElevated,
        },
        title: {
            ...theme.type.caption,
            color: theme.colors.textSecondary,
            paddingHorizontal: spacing.xs,
            paddingVertical: spacing.xs,
        },
        divider: {
            height: StyleSheet.hairlineWidth,
            marginHorizontal: spacing.xs,
            backgroundColor: theme.colors.border,
        },
        row: {
            minHeight: 52,
            justifyContent: 'center',
            paddingHorizontal: spacing.xs,
            borderRadius: radii.sm,
        },
        rowPressed: { backgroundColor: theme.colors.glassAccent },
        rowDisabled: { opacity: 0.45 },
        dangerRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
        },
        rowLabel: {
            ...theme.type.body,
            fontSize: 16,
            color: theme.colors.text,
        },
        rowDanger: { color: theme.colors.danger },
        cancel: {
            minHeight: 48,
            marginTop: spacing.xxs,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radii.sm,
        },
        cancelText: {
            ...theme.type.body,
            color: theme.colors.textSecondary,
        },
    });
