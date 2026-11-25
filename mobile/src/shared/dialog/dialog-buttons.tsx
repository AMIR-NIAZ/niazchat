import { memo } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing } from '../theme';
import { mixColors } from '../theme/colors';
import { useTheme, useThemedStyles } from '../theme/theme-provider';
import type { AppTheme } from '../theme/theme-provider';
import type { DialogButton } from './dialog-types';
import { AppText } from '../components';

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
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
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
                                        ? [
                                              theme.colors.danger,
                                              mixColors(
                                                  theme.colors.danger,
                                                  '#000000',
                                                  0.15,
                                              ),
                                          ]
                                        : [
                                              theme.accent,
                                              mixColors(
                                                  theme.accent,
                                                  theme.colors.background,
                                                  0.22,
                                              ),
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
                                        ? theme.colors.text
                                        : theme.colors.accentText
                                }
                            />
                        ) : (
                            <AppText
                                style={[
                                    styles.label,
                                    cancel
                                        ? styles.cancelLabel
                                        : styles.filledLabel,
                                ]}
                                numberOfLines={2}
                            >
                                {button.text}
                            </AppText>
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
});

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
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
            borderColor: theme.colors.border,
        },
        cancel: {
            backgroundColor: theme.colors.glassSurface,
            borderColor: theme.colors.borderStrong,
        },
        pressed: {
            transform: [{ scale: 0.97 }],
            opacity: 0.92,
        },
        dimmed: { opacity: 0.45 },
        label: {
            ...theme.type.label,
            fontSize: 15,
            textAlign: 'center',
        },
        filledLabel: { color: theme.colors.accentText },
        cancelLabel: { color: theme.colors.text },
    });
