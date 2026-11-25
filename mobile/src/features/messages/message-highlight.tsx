import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../shared/hooks/use-reduced-motion';
import { useTheme } from '../../shared/theme';

/**
 * Shared jump-target highlight for reply and pinned-message navigation.
 *
 * A translucent accent wash is painted over the bubble's own surface (never a
 * border/outline): it fades in, gives one soft pulse and fades out before the
 * screen's highlight window ends. The overlay is absolutely positioned and
 * ignores touches, so it can never change the bubble's size, padding or radius.
 */

/** Peak overlay opacity: visible on both bubble colors, never washes text out. */
const PEAK_OPACITY = 0.16;
/** Matches the asymmetric tail radius in `message-bubble` styles. */
const TAIL_RADIUS = 4;

interface MessageHighlightProps {
    /** Mine bubbles have the tail on the other side. */
    mine: boolean;
}

/** Mounted only for the current jump target, so one wash exists at a time. */
export function MessageHighlight({
    mine,
}: MessageHighlightProps): React.ReactElement {
    const reduceMotion = useReducedMotion();
    const theme = useTheme();
    const progress = useSharedValue(0);
    const radius = theme.radius.bubble;

    useEffect((): (() => void) => {
        if (reduceMotion) {
            progress.value = 1;
            return (): void => undefined;
        }
        progress.value = withSequence(
            // Fade in.
            withTiming(1, {
                duration: 160,
                easing: Easing.out(Easing.cubic),
            }),
            // A single restrained pulse.
            withTiming(0.6, {
                duration: 240,
                easing: Easing.inOut(Easing.sin),
            }),
            withTiming(1, {
                duration: 280,
                easing: Easing.inOut(Easing.sin),
            }),
            // Gradual fade-out, complete inside the screen's 1 s window.
            withTiming(0, {
                duration: 260,
                easing: Easing.in(Easing.cubic),
            }),
        );
        return (): void => {
            cancelAnimation(progress);
        };
    }, [progress, reduceMotion]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: progress.value * PEAK_OPACITY,
    }));

    return (
        <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden={true}
            importantForAccessibility="no-hide-descendants"
            style={[
                StyleSheet.absoluteFill,
                {
                    backgroundColor: theme.accent,
                    borderTopLeftRadius: radius,
                    borderTopRightRadius: radius,
                    borderBottomLeftRadius: mine ? radius : TAIL_RADIUS,
                    borderBottomRightRadius: mine ? TAIL_RADIUS : radius,
                },
                animatedStyle,
            ]}
        />
    );
}
