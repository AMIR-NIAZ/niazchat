import { useEffect, useRef, useState } from 'react';
import {
    AccessibilityInfo,
    Animated,
    Easing,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { palette, radii, spacing } from '../../shared/theme';

/**
 * Round floating "scroll to latest" button, anchored to the end side of the
 * list container (above the composer, so it follows the keyboard).
 *
 * Fades/scales in and out with the native driver; unmounted once the fade-out
 * finishes so it can never intercept touches while hidden. Reduced motion
 * shows/hides it instantly.
 */

interface ScrollToBottomButtonProps {
    visible: boolean;
    /** New messages from other members while scrolled up (0 = no badge). */
    count: number;
    onPress: () => void;
}

const ANIMATION_MS = 170;

function badgeLabel(count: number): string {
    return count > 99 ? '99+' : String(count);
}

export function ScrollToBottomButton(
    props: ScrollToBottomButtonProps,
): React.ReactElement | null {
    const progress = useRef(new Animated.Value(0)).current;
    const [reduceMotion, setReduceMotion] = useState(false);
    const [interactive, setInteractive] = useState(false);

    useEffect((): (() => void) => {
        let mounted = true;
        AccessibilityInfo.isReduceMotionEnabled()
            .then((enabled): void => {
                if (mounted) {
                    setReduceMotion(enabled);
                }
            })
            .catch((): void => undefined);
        const subscription = AccessibilityInfo.addEventListener(
            'reduceMotionChanged',
            (enabled): void => setReduceMotion(enabled),
        );
        return (): void => {
            mounted = false;
            subscription.remove();
        };
    }, []);

    useEffect((): (() => void) => {
        if (props.visible) {
            setInteractive(true);
        }
        progress.stopAnimation();
        if (reduceMotion) {
            progress.setValue(props.visible ? 1 : 0);
            if (!props.visible) {
                setInteractive(false);
            }
            return (): void => undefined;
        }
        const animation = Animated.timing(progress, {
            toValue: props.visible ? 1 : 0,
            duration: ANIMATION_MS,
            easing: props.visible
                ? Easing.out((value: number): number => Easing.quad(value))
                : Easing.in((value: number): number => Easing.quad(value)),
            useNativeDriver: true,
        });
        animation.start(({ finished }): void => {
            if (finished && !props.visible) {
                setInteractive(false);
            }
        });
        return (): void => {
            animation.stop();
        };
    }, [progress, props.visible, reduceMotion]);

    if (!props.visible && !interactive) {
        return null;
    }

    const label =
        props.count > 0
            ? `Scroll to latest messages, ${String(props.count)} new`
            : 'Scroll to latest messages';

    return (
        <Animated.View
            pointerEvents={interactive ? 'auto' : 'none'}
            style={[
                styles.wrap,
                {
                    opacity: progress,
                    transform: [
                        {
                            translateY: progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [8, 0],
                            }),
                        },
                        {
                            scale: progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.85, 1],
                            }),
                        },
                    ],
                },
            ]}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                hitSlop={8}
                onPress={props.onPress}
                style={styles.button}
                android_ripple={{
                    color: 'rgba(255,255,255,0.82)',
                    borderless: true,
                }}
            >
                <Text style={styles.chevron} allowFontScaling={false}>
                    ⌄
                </Text>
                {props.count > 0 && (
                    <View style={styles.badge} pointerEvents="none">
                        <Text style={styles.badgeText} allowFontScaling={false}>
                            {badgeLabel(props.count)}
                        </Text>
                    </View>
                )}
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: 'absolute',
        end: spacing.md,
        bottom: spacing.sm,
        width: 46,
        height: 46,
    },
    button: {
        width: 46,
        height: 46,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.neutral[0],
        borderWidth: 1,
        borderColor: palette.neutral[300],
        shadowColor: palette.neutral[900],
        shadowOpacity: 0.18,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
    },
    chevron: {
        color: palette.primary[700],
        fontSize: 22,
        fontWeight: '700',
        lineHeight: 26,
        textAlign: 'center',
    },
    badge: {
        position: 'absolute',
        top: -4,
        end: -4,
        minWidth: 20,
        height: 20,
        paddingHorizontal: 5,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.semantic.danger,
        borderWidth: 1,
        borderColor: palette.neutral[0],
    },
    badgeText: {
        color: palette.text.onAccent,
        fontSize: 11,
        fontWeight: '700',
    },
});
