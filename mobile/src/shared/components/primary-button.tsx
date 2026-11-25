import { useRef } from 'react';
import {
    ActivityIndicator,
    Animated,
    Pressable,
    StyleSheet,
    Text,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { motion, radii, shadows, spacing } from '../theme';
import { useTheme, useThemedStyles } from '../theme/theme-provider';
import type { AppTheme } from '../theme/theme-provider';
import { AppText } from './app-text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface PrimaryButtonProps {
    label: string;
    onPress: () => void;
    variant?: Variant;
    loading?: boolean;
    disabled?: boolean;
    /** Stretch to the container width. Default: true. */
    fullWidth?: boolean;
    /** Compact height for header actions. */
    compact?: boolean;
    accessibilityLabel?: string;
    style?: StyleProp<ViewStyle>;
}

/**
 * Brand button with a spring press response. The scale animates on the native
 * driver; reduced-motion users only get the opacity feedback.
 *
 * The primary fill is the active accent and its label uses the automatically
 * computed readable color, so every accent preset stays legible.
 */
export function PrimaryButton({
    label,
    onPress,
    variant = 'primary',
    loading = false,
    disabled = false,
    fullWidth = true,
    compact = false,
    accessibilityLabel,
    style,
}: PrimaryButtonProps): React.ReactElement {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const scale = useRef(new Animated.Value(1)).current;
    const reduceMotion = useReducedMotion();
    const inactive = disabled || loading;

    const springTo = (toValue: number): void => {
        if (reduceMotion) {
            return;
        }
        Animated.spring(scale, {
            toValue,
            ...motion.spring,
            useNativeDriver: true,
        }).start();
    };

    return (
        <Animated.View
            style={[
                fullWidth && styles.fullWidth,
                !reduceMotion && { transform: [{ scale }] },
                variant === 'primary' && !inactive && shadows.floating,
                style,
            ]}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel ?? label}
                accessibilityState={{ disabled: inactive, busy: loading }}
                disabled={inactive}
                onPress={onPress}
                onPressIn={(): void => springTo(motion.pressScale)}
                onPressOut={(): void => springTo(1)}
                style={({ pressed }) => [
                    styles.base,
                    compact && styles.compact,
                    styles[variant],
                    inactive && styles.disabled,
                    pressed && !reduceMotion && styles.pressedOpacity,
                ]}
            >
                {loading ? (
                    <ActivityIndicator
                        size="small"
                        color={
                            variant === 'primary' || variant === 'danger'
                                ? variant === 'primary'
                                    ? theme.colors.accentText
                                    : theme.colors.danger
                                : theme.accent
                        }
                    />
                ) : (
                    <AppText style={[styles.label, styles[`${variant}Label`]]}>
                        {label}
                    </AppText>
                )}
            </Pressable>
        </Animated.View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
        fullWidth: { alignSelf: 'stretch' },
        base: {
            minHeight: 50,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.lg,
            borderRadius: radii.lg,
            borderWidth: 1,
        },
        compact: {
            minHeight: 36,
            paddingHorizontal: spacing.sm,
            borderRadius: radii.full,
        },
        primary: {
            backgroundColor: theme.accent,
            borderColor: theme.colors.accentBorder,
        },
        secondary: {
            backgroundColor: theme.colors.glassElevated,
            borderColor: theme.colors.borderStrong,
        },
        ghost: {
            backgroundColor: 'transparent',
            borderColor: 'transparent',
        },
        danger: {
            backgroundColor: theme.colors.dangerSoft,
            borderColor: theme.colors.danger,
        },
        disabled: { opacity: 0.45 },
        pressedOpacity: { opacity: 0.9 },
        label: {
            ...theme.type.label,
            fontSize: 16,
        },
        primaryLabel: { color: theme.colors.accentText },
        secondaryLabel: { color: theme.colors.text },
        ghostLabel: { color: theme.accent },
        dangerLabel: { color: theme.colors.danger },
    });
