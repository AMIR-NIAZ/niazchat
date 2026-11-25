import { useCallback, useEffect, useMemo, useRef } from 'react';
import { I18nManager, StyleSheet, View } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { radii } from '../../shared/components';
import { useTheme } from '../../shared/theme';

/**
 * A themed 0–100 slider for the Appearance blur/dim controls.
 *
 * The project has no slider dependency, and Reanimated + Gesture Handler are
 * already installed, so this is a small custom slider instead of a new package.
 *
 * - The fill and thumb are driven by shared values on the UI thread, so the
 *   drag stays smooth regardless of JS work.
 * - `onChange` fires only when the snapped (step 5) value changes, for the live
 *   preview; `onCommit` fires once on release for the persisted write.
 * - A light haptic marks the 25% steps and the two ends (expo-haptics is
 *   already a dependency).
 * - RTL: the fill starts at the inline start edge and the thumb moves with the
 *   layout direction (`I18nManager.isRTL`).
 */

const TRACK_HEIGHT = 6;
const THUMB_SIZE = 22;
const HIT_HEIGHT = 44;
const STEP = 5;

export interface AppValueSliderProps {
    /** Current value, 0–100. */
    value: number;
    /** Accessible name, e.g. "Blur". */
    label: string;
    disabled?: boolean;
    /** Live value while dragging (already snapped to 5%). */
    onChange: (value: number) => void;
    /** Final value, fired once on release. */
    onCommit: (value: number) => void;
}

export function AppValueSlider({
    value,
    label,
    disabled = false,
    onChange,
    onCommit,
}: AppValueSliderProps): React.ReactElement {
    const theme = useTheme();
    const rtl = I18nManager.isRTL;
    const width = useSharedValue(0);
    const progress = useSharedValue(value);
    const dragging = useSharedValue(false);
    const lastReported = useSharedValue(value);
    const lastCommitted = useSharedValue(value);
    const lastHapticQuarter = useSharedValue(-1);

    // Keep the latest callbacks reachable from the (stable) gesture without
    // rebuilding it mid-drag.
    const callbacks = useRef({ onChange, onCommit });
    callbacks.current = { onChange, onCommit };

    // External changes (e.g. Reset) animate instead of jumping. While the user
    // is dragging the prop is stale, so the thumb must not be pulled back.
    useEffect((): void => {
        if (dragging.value) {
            return;
        }
        progress.value = withTiming(value, { duration: 180 });
        lastReported.value = value;
        lastCommitted.value = value;
    }, [value, progress, dragging, lastReported, lastCommitted]);

    const reportChange = useCallback((next: number): void => {
        callbacks.current.onChange(next);
    }, []);

    const reportCommit = useCallback((next: number): void => {
        callbacks.current.onCommit(next);
    }, []);

    const fireHaptic = useCallback((strong: boolean): void => {
        void Haptics.impactAsync(
            strong
                ? Haptics.ImpactFeedbackStyle.Medium
                : Haptics.ImpactFeedbackStyle.Light,
        ).catch((): void => undefined);
    }, []);

    const fillStyle = useAnimatedStyle(() => {
        const usable = Math.max(0, width.value - THUMB_SIZE);
        return {
            width: THUMB_SIZE / 2 + (progress.value / 100) * usable,
        };
    });

    const thumbStyle = useAnimatedStyle(() => {
        const usable = Math.max(0, width.value - THUMB_SIZE);
        const offset = (progress.value / 100) * usable;
        return {
            transform: [{ translateX: rtl ? -offset : offset }],
        };
    });

    const gesture = useMemo(() => {
        const applyX = (x: number): void => {
            'worklet';
            if (width.value <= 0) {
                return;
            }
            const physical = Math.min(1, Math.max(0, x / width.value)) * 100;
            const logical = rtl ? 100 - physical : physical;
            const snapped = Math.min(
                100,
                Math.max(0, Math.round(logical / STEP) * STEP),
            );
            if (snapped !== progress.value) {
                progress.value = snapped;
            }
            if (snapped !== lastReported.value) {
                lastReported.value = snapped;
                scheduleOnRN(reportChange, snapped);
            }
            const quarter = Math.round(snapped / 25);
            if (quarter !== lastHapticQuarter.value) {
                lastHapticQuarter.value = quarter;
                scheduleOnRN(fireHaptic, quarter === 0 || quarter === 4);
            }
        };

        return (
            Gesture.Pan()
                .enabled(!disabled)
                // Only claim horizontal drags, so the settings list still scrolls
                // when a touch starts on the slider.
                .activeOffsetX([-6, 6])
                .failOffsetY([-12, 12])
                .onStart((event): void => {
                    'worklet';
                    dragging.value = true;
                    applyX(event.x);
                })
                .onUpdate((event): void => {
                    'worklet';
                    applyX(event.x);
                })
                .onEnd((): void => {
                    'worklet';
                    const settled = Math.min(
                        100,
                        Math.max(0, Math.round(progress.value / STEP) * STEP),
                    );
                    progress.value = settled;
                    lastReported.value = settled;
                })
                .onFinalize((): void => {
                    'worklet';
                    dragging.value = false;
                    // A cancelled gesture still saves what the user last saw.
                    if (progress.value !== lastCommitted.value) {
                        lastCommitted.value = progress.value;
                        scheduleOnRN(reportCommit, progress.value);
                    }
                })
        );
    }, [
        disabled,
        rtl,
        width,
        progress,
        dragging,
        lastReported,
        lastCommitted,
        lastHapticQuarter,
        reportChange,
        reportCommit,
        fireHaptic,
    ]);

    const adjust = (delta: number): void => {
        const next = Math.min(
            100,
            Math.max(0, Math.round(value / STEP) * STEP + delta),
        );
        callbacks.current.onChange(next);
        callbacks.current.onCommit(next);
    };

    const anchor = rtl ? styles.anchorEnd : styles.anchorStart;

    return (
        <GestureDetector gesture={gesture}>
            <View
                style={styles.hit}
                onLayout={(event): void => {
                    width.value = event.nativeEvent.layout.width;
                }}
                accessible={true}
                accessibilityRole="adjustable"
                accessibilityLabel={label}
                accessibilityValue={{
                    min: 0,
                    max: 100,
                    now: Math.round(value),
                    text: `${Math.round(value)}%`,
                }}
                accessibilityState={{ disabled }}
                accessibilityActions={[
                    { name: 'increment', label: 'Increase' },
                    { name: 'decrement', label: 'Decrease' },
                ]}
                onAccessibilityAction={(event): void => {
                    if (event.nativeEvent.actionName === 'increment') {
                        adjust(STEP);
                    } else if (event.nativeEvent.actionName === 'decrement') {
                        adjust(-STEP);
                    }
                }}
            >
                <View
                    pointerEvents="none"
                    style={[
                        styles.track,
                        { backgroundColor: theme.colors.borderStrong },
                    ]}
                />
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.fill,
                        anchor,
                        { backgroundColor: theme.accent },
                        fillStyle,
                    ]}
                />
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.thumb,
                        anchor,
                        {
                            backgroundColor: theme.accent,
                            borderColor: theme.colors.surface,
                        },
                        thumbStyle,
                    ]}
                />
            </View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    hit: {
        height: HIT_HEIGHT,
        justifyContent: 'center',
    },
    track: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: (HIT_HEIGHT - TRACK_HEIGHT) / 2,
        height: TRACK_HEIGHT,
        borderRadius: radii.full,
    },
    fill: {
        position: 'absolute',
        top: (HIT_HEIGHT - TRACK_HEIGHT) / 2,
        height: TRACK_HEIGHT,
        borderRadius: radii.full,
    },
    thumb: {
        position: 'absolute',
        top: (HIT_HEIGHT - THUMB_SIZE) / 2,
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: THUMB_SIZE / 2,
        borderWidth: 2,
    },
    anchorStart: { left: 0 },
    anchorEnd: { right: 0 },
});
