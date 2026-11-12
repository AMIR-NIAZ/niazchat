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
import { motion, palette, radii, shadows, spacing, typography } from '../theme';

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
                                ? palette.text.onAccent
                                : palette.primary[600]
                        }
                    />
                ) : (
                    <Text style={[styles.label, styles[`${variant}Label`]]}>
                        {label}
                    </Text>
                )}
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
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
        backgroundColor: palette.primary[500],
        borderColor: 'rgba(220,197,255,0.32)',
    },
    secondary: {
        backgroundColor: palette.glass.elevated,
        borderColor: palette.border.strong,
    },
    ghost: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
    },
    danger: {
        backgroundColor: 'rgba(255,122,138,0.16)',
        borderColor: 'rgba(255,122,138,0.38)',
    },
    disabled: { opacity: 0.45 },
    pressedOpacity: { opacity: 0.9 },
    label: { ...typography.label, fontSize: 16, fontWeight: '700' },
    primaryLabel: { color: palette.text.onAccent },
    secondaryLabel: { color: palette.text.primary },
    ghostLabel: { color: palette.primary[600] },
    dangerLabel: { color: palette.semantic.danger },
});
