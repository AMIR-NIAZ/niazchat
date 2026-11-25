import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ArrowDown } from 'lucide-react-native';
import { GlassSurface } from '../../shared/components/glass-surface';
import { useReducedMotion } from '../../shared/hooks/use-reduced-motion';
import {
    blur,
    motion,
    palette,
    radii,
    shadows,
    spacing,
} from '../../shared/theme';
import { useTheme, useThemedStyles } from '../../shared/theme';
import type { AppTheme } from '../../shared/theme';
import { AppText } from '../../shared/components';

/**
 * Floating "scroll to latest" control: a small glass circle with a lavender
 * arrow, anchored above the composer by the screen (which owns the safe-area
 * and keyboard offsets).
 *
 * Visibility is animated rather than toggled: the button fades/scales in when
 * the user scrolls away from the newest message and back out when they reach
 * it, then unmounts so its blur and touch surface never linger. Reduced motion
 * swaps the transition for an instant state change.
 */

interface ScrollToBottomButtonProps {
    visible: boolean;
    /** New messages from other members while scrolled up (0 = no badge). */
    count: number;
    /**
     * Distance from the bottom of the list container: the measured composer
     * stack, so the button floats exactly above the input bar (and follows the
     * keyboard with it).
     */
    bottomOffset?: number;
    onPress: () => void;
}

const SIZE = 44;
const BADGE_SIZE = 18;

const ENTER = {
    duration: motion.duration.normal,
    easing: Easing.out(Easing.cubic),
} as const;
const EXIT = {
    duration: motion.duration.fast + 30,
    easing: Easing.in(Easing.cubic),
} as const;

const PRESS_IN = { damping: 18, stiffness: 320, mass: 0.6 } as const;
const PRESS_OUT = { damping: 16, stiffness: 280, mass: 0.6 } as const;

function badgeLabel(count: number): string {
    return count > 99 ? '99+' : String(count);
}

export function ScrollToBottomButton(
    props: ScrollToBottomButtonProps,
): React.ReactElement | null {
    const theme = useTheme();
    const styles = useThemedStyles(createStyles);
    const reduceMotion = useReducedMotion();
    const progress = useSharedValue(0);
    const pressScale = useSharedValue(1);
    const [mounted, setMounted] = useState(props.visible);

    useEffect((): void => {
        pressScale.value = 1;
        if (props.visible) {
            setMounted(true);
            progress.value = reduceMotion ? 1 : withTiming(1, ENTER);
            return;
        }
        if (reduceMotion) {
            progress.value = 0;
            setMounted(false);
            return;
        }
        progress.value = withTiming(0, EXIT, (finished): void => {
            'worklet';
            if (finished) {
                scheduleOnRN(setMounted, false);
            }
        });
    }, [pressScale, progress, props.visible, reduceMotion]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [
            {
                translateY: interpolate(progress.value, [0, 1], [12, 0]),
            },
            {
                scale:
                    interpolate(progress.value, [0, 1], [0.9, 1]) *
                    pressScale.value,
            },
        ],
    }));

    if (!mounted) {
        return null;
    }

    const label =
        props.count > 0
            ? `Scroll to latest messages, ${String(props.count)} new`
            : 'Scroll to latest messages';

    return (
        <Animated.View
            pointerEvents={props.visible ? 'auto' : 'none'}
            style={[
                styles.wrap,
                { bottom: props.bottomOffset ?? spacing.sm },
                animatedStyle,
            ]}
            accessibilityElementsHidden={!props.visible}
            importantForAccessibility={
                props.visible ? 'auto' : 'no-hide-descendants'
            }
        >
            <View style={styles.shadow}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityHint="Scrolls to the newest message"
                    hitSlop={10}
                    onPress={props.onPress}
                    onPressIn={(): void => {
                        if (!reduceMotion) {
                            pressScale.value = withSpring(0.93, PRESS_IN);
                        }
                        // Selection feedback only: the action is a jump, not a
                        // confirmation. Unavailable on some simulators.
                        try {
                            void Haptics.selectionAsync();
                        } catch {
                            // Ignore unsupported haptics targets.
                        }
                    }}
                    onPressOut={(): void => {
                        pressScale.value = reduceMotion
                            ? 1
                            : withSpring(1, PRESS_OUT);
                    }}
                    style={({ pressed }) => [
                        styles.press,
                        pressed && styles.pressPressed,
                    ]}
                    android_ripple={{ color: theme.colors.border }}
                >
                    <GlassSurface
                        intensity={blur.strong}
                        tone="elevated"
                        radius={radii.full}
                        style={styles.glass}
                    >
                        <LinearGradient
                            pointerEvents="none"
                            colors={[
                                theme.colors.accentSoft,
                                theme.colors.glassAccent,
                                'transparent',
                            ]}
                            locations={[0, 0.55, 1]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={StyleSheet.absoluteFill}
                        />
                        <ArrowDown
                            size={20}
                            strokeWidth={2.4}
                            color={theme.accent}
                        />
                    </GlassSurface>
                </Pressable>
            </View>

            {props.count > 0 && (
                <View
                    style={styles.badge}
                    pointerEvents="none"
                    accessibilityElementsHidden={true}
                    importantForAccessibility="no-hide-descendants"
                >
                    <AppText style={styles.badgeText} allowFontScaling={false}>
                        {badgeLabel(props.count)}
                    </AppText>
                </View>
            )}
        </Animated.View>
    );
}

const createStyles = (theme: AppTheme) =>
    StyleSheet.create({
    wrap: {
        position: 'absolute',
        end: spacing.md,
        width: SIZE,
        height: SIZE,
    },
    shadow: {
        width: SIZE,
        height: SIZE,
        borderRadius: radii.full,
        // The shadow stays on this transparent wrapper (iOS) so the glass keeps
        // its own overflow clipping; Android elevation lives on the glass.
        shadowColor: shadows.glass.shadowColor,
        shadowOpacity: shadows.glass.shadowOpacity,
        shadowRadius: shadows.glass.shadowRadius,
        shadowOffset: shadows.glass.shadowOffset,
    },
    press: {
        width: SIZE,
        height: SIZE,
        borderRadius: radii.full,
        overflow: 'hidden',
    },
    pressPressed: {
        backgroundColor: theme.colors.glassSurface,
    },
    glass: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderColor: theme.colors.borderStrong,
        elevation: shadows.glass.elevation,
    },
    badge: {
        position: 'absolute',
        top: -5,
        end: -5,
        minWidth: BADGE_SIZE,
        height: BADGE_SIZE,
        paddingHorizontal: 4,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.accent,
        borderWidth: Platform.OS === 'android' ? 1.5 : 2,
        borderColor: theme.colors.background,
        shadowColor: theme.accent,
        shadowOpacity: 0.35,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
    },
    badgeText: {
        color: theme.colors.accentText,
        fontSize: 10,
        fontWeight: '700',
        lineHeight: 13,
        fontVariant: ['tabular-nums'],
    },
});
