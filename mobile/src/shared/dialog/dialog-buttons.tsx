import { memo } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { palette, spacing } from '../theme';
import type { DialogButton } from './dialog-types';

interface DialogButtonsProps {
    buttons: readonly DialogButton[];
    /** Index of the button whose async `onPress` is still settling. */
    busyIndex: number | null;
    onPress: (button: DialogButton, index: number) => void;
}

/**
 * 1–2 buttons sit side by side (cancel first), 3+ stack vertically. Every
 * button is a 48 px pill with a 0.97 press scale; a filled button keeps its
 * purple (or red) gradient, a cancel button stays a ghost outline.
 *
 * Memoized: the exit animation re-renders nothing inside the card.
 */
export const DialogButtons = memo(function DialogButtons({
    buttons,
    busyIndex,
    onPress,
}: DialogButtonsProps): React.ReactElement {
    const stacked = buttons.length > 2;
    const busy = busyIndex !== null;

    return (
        <View style={[styles.row, stacked && styles.column]}>
            {buttons.map((button, index) => {
                const destructive = button.style === 'destructive';
                const cancel = button.style === 'cancel';
                const loading = busyIndex === index;
                return (
                    <Pressable
                        key={`${button.text}-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={button.text}
                        accessibilityState={{
                            disabled: busy,
                            busy: loading,
                        }}
                        disabled={busy}
                        onPress={(): void => onPress(button, index)}
                        style={({ pressed }) => [
                            styles.button,
                            stacked ? styles.full : styles.grow,
                            pressed && !busy && styles.pressed,
                            cancel && styles.cancel,
                            busy && !loading && styles.dimmed,
                        ]}
                    >
                        {cancel ? null : (
                            <LinearGradient
                                pointerEvents="none"
                                colors={
                                    destructive
                                        ? [palette.semantic.danger, '#E4566A']
                                        : [
                                              palette.primary[500],
                                              palette.primary[600],
                                          ]
                                }
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={StyleSheet.absoluteFill}
                            />
                        )}
                        {loading ? (
                            <ActivityIndicator
                                size="small"
                                color={
                                    cancel
                                        ? palette.text.primary
                                        : palette.text.onAccent
                                }
                            />
                        ) : (
                            <Text
                                style={[
                                    styles.label,
                                    cancel
                                        ? styles.cancelLabel
                                        : styles.filledLabel,
                                ]}
                                numberOfLines={2}
                            >
                                {button.text}
                            </Text>
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
});

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: spacing.xs,
        width: '100%',
    },
    column: { flexDirection: 'column' },
    grow: { flex: 1 },
    full: { width: '100%' },
    button: {
        minHeight: 48,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.10)',
    },
    cancel: {
        backgroundColor: 'rgba(220,197,255,0.06)',
        borderColor: palette.border.strong,
    },
    pressed: {
        transform: [{ scale: 0.97 }],
        opacity: 0.92,
    },
    dimmed: { opacity: 0.45 },
    label: {
        fontSize: 15,
        fontWeight: '700',
        textAlign: 'center',
    },
    filledLabel: { color: palette.text.onAccent },
    cancelLabel: { color: palette.text.primary },
});
