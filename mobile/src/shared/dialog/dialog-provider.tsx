import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import {
    AccessibilityInfo,
    BackHandler,
    Keyboard,
    PanResponder,
    Platform,
    Pressable,
    StyleSheet,
    View,
    useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { palette } from '../theme';
import { DialogCard } from './dialog-card';
import {
    dialogStore,
    getDialogSession,
    getToastSession,
    dialogStoreSubscribe,
    toastStore,
    toastStoreSubscribe,
} from './dialog-store';
import type { DialogButton } from './dialog-types';
import { ToastPill } from './toast-pill';

/**
 * Hosts for the themed dialog and toast, mounted once above the navigator.
 *
 * Same philosophy as the context-popup host: NO `Modal`, NO native `Alert`.
 * The host is an absolutely positioned overlay (`zIndex`/`elevation` 1100,
 * above the 1000 popup host and the floating tab bar) inside the app tree, so
 * it covers screens and headers alike. Requests queue in a module-level store;
 * only one card is visible at a time.
 *
 * Animations run on the UI thread from shared values:
 * - open: scrim 180 ms timing, card springs from scale 0.9 / +12 px with a
 *   small overshoot (`damping 14, stiffness 260, mass 0.7`), tone badge pops
 *   0.6 → 1.1 → 1;
 * - close: 150 ms `bezier(0.4, 0, 0.2, 1)`, card to 0.95 / opacity 0, and the
 *   button's `onPress` runs only after that completes (via `scheduleOnRN`);
 * - Reduce Motion: opacity only, 90 ms, no springs, no transforms.
 */

const OVERLAY_Z = 1100;
const TOAST_Z = 1200;

const SCRIM_MS = 180;
const CLOSE_MS = 150;
const REDUCED_MS = 90;
const SCRIM_OPACITY = 0.7;
const BLUR_INTENSITY = 20;
const CLOSE_EASING = Easing.bezier(0.4, 0, 0.2, 1);

const CARD_SPRING = { damping: 14, stiffness: 260, mass: 0.7 };
const ICON_SPRING = { damping: 12, stiffness: 220, mass: 0.6 };
const TOAST_SPRING = { damping: 16, stiffness: 240, mass: 0.8 };

const CARD_MAX_WIDTH = 360;
const CARD_SIDE_MARGIN = 24;
const TOAST_ENTRY_SHIFT = 40;
const TOAST_SWIPE_DISMISS = -24;

function isAsyncHandler(handler: DialogButton['onPress']): boolean {
    return (
        handler !== undefined &&
        Object.prototype.toString.call(handler) === '[object AsyncFunction]'
    );
}

export function DialogProvider({
    children,
}: {
    children: ReactNode;
}): React.ReactElement {
    return (
        <>
            {children}
            <DialogOverlay />
            <ToastHost />
        </>
    );
}

// ── Dialog ──────────────────────────────────────────────────────────────────

function DialogOverlay(): React.ReactElement {
    const session = useSyncExternalStore(
        dialogStoreSubscribe,
        getDialogSession,
    );
    const window = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();

    const progress = useSharedValue(0);
    const cardScale = useSharedValue(1);
    const cardY = useSharedValue(0);
    const iconScale = useSharedValue(1);

    const afterCloseRef = useRef<(() => void) | null>(null);
    /** `{ id, index }`: a stale busy flag never leaks onto the next dialog. */
    const [busy, setBusy] = useState<{ id: number; index: number } | null>(
        null,
    );
    const [keyboardHeight, setKeyboardHeight] = useState(0);

    useEffect((): (() => void) => {
        const show = Keyboard.addListener('keyboardDidShow', (event): void => {
            setKeyboardHeight(event.endCoordinates.height);
        });
        const hide = Keyboard.addListener('keyboardDidHide', (): void => {
            setKeyboardHeight(0);
        });
        return (): void => {
            show.remove();
            hide.remove();
        };
    }, []);

    const handleClosed = useCallback((): void => {
        const after = afterCloseRef.current;
        afterCloseRef.current = null;
        dialogStore.finishClose();
        if (after !== null) {
            after();
        }
    }, []);

    const requestClose = useCallback(
        (after?: () => void): void => {
            if (!dialogStore.beginClose()) {
                return;
            }
            if (after !== undefined) {
                afterCloseRef.current = after;
            }
            const duration = reduceMotion ? REDUCED_MS : CLOSE_MS;
            progress.value = withTiming(
                0,
                { duration, easing: CLOSE_EASING },
                (finished): void => {
                    'worklet';
                    if (finished) {
                        scheduleOnRN(handleClosed);
                    }
                },
            );
            cardScale.value = withTiming(reduceMotion ? 1 : 0.95, {
                duration,
                easing: CLOSE_EASING,
            });
            cardY.value = withTiming(reduceMotion ? 0 : 8, {
                duration,
                easing: CLOSE_EASING,
            });
        },
        [reduceMotion, progress, cardScale, cardY, handleClosed],
    );

    // Entrance. Runs once per committed session; the queue only promotes the
    // next dialog after the previous one's exit has finished.
    useEffect((): void => {
        if (session === null) {
            return;
        }
        setBusy(null);
        afterCloseRef.current = null;
        progress.value = 0;
        cardScale.value = reduceMotion ? 1 : 0.9;
        cardY.value = reduceMotion ? 0 : 12;
        iconScale.value = reduceMotion ? 1 : 0.6;

        try {
            AccessibilityInfo.announceForAccessibility(
                session.message === null
                    ? session.title
                    : `${session.title}. ${session.message}`,
            );
            if (session.tone === 'danger') {
                void Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Warning,
                );
            } else if (session.tone === 'success') {
                void Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                );
            } else {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
        } catch {
            // Haptics / announcements are unavailable on some targets.
        }

        if (reduceMotion) {
            progress.value = withTiming(1, { duration: REDUCED_MS });
            return;
        }
        progress.value = withTiming(1, {
            duration: SCRIM_MS,
            easing: Easing.out(Easing.quad),
        });
        cardScale.value = withSpring(1, CARD_SPRING);
        cardY.value = withSpring(0, CARD_SPRING);
        iconScale.value = withSequence(
            withTiming(1.1, { duration: 130 }),
            withSpring(1, ICON_SPRING),
        );
    }, [session, reduceMotion, progress, cardScale, cardY, iconScale]);

    // Android back: dismiss like a cancel, and always consume the press while
    // a dialog is visible.
    useEffect((): (() => void) | undefined => {
        if (session === null) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener(
            'hardwareBackPress',
            (): boolean => {
                if (session.cancelable) {
                    requestClose(session.onDismiss);
                }
                return true;
            },
        );
        return (): void => {
            subscription.remove();
        };
    }, [session, requestClose]);

    const handleButtonPress = useCallback(
        (button: DialogButton, index: number): void => {
            if (session === null || busy !== null) {
                return;
            }
            if (button.onPress === undefined) {
                requestClose();
                return;
            }
            const handler = button.onPress;
            if (isAsyncHandler(handler)) {
                // Async actions run while the card is open so the spinner can
                // show; the card closes when they resolve and stays open if
                // they reject (the caller reports the error).
                const id = session.id;
                setBusy({ id, index });
                void Promise.resolve(handler()).then(
                    (): void => {
                        setBusy(null);
                        requestClose();
                    },
                    (): void => {
                        setBusy(null);
                    },
                );
                return;
            }
            // Sync actions run only once the exit animation finished.
            // (This branch is never an async handler; `void` keeps the
            // possibly-async signature out of `requestClose`.)
            requestClose((): void => {
                void handler();
            });
        },
        [session, busy, requestClose],
    );

    const cardStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [{ translateY: cardY.value }, { scale: cardScale.value }],
    }));
    const iconStyle = useAnimatedStyle(() => ({
        transform: [{ scale: iconScale.value }],
    }));

    const width = Math.min(window.width - CARD_SIDE_MARGIN * 2, CARD_MAX_WIDTH);
    const bottomPad = keyboardHeight > 0 ? keyboardHeight : insets.bottom;
    const busyIndex =
        busy !== null && session !== null && busy.id === session.id
            ? busy.index
            : null;

    return (
        <View
            pointerEvents={session === null ? 'none' : 'box-none'}
            style={styles.overlay}
            accessibilityViewIsModal={session !== null}
            importantForAccessibility={
                session === null ? 'no-hide-descendants' : 'yes'
            }
        >
            {session !== null && (
                <>
                    <DialogBackdrop progress={progress} />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Dismiss dialog"
                        onPress={(): void => {
                            if (session.cancelable) {
                                requestClose(session.onDismiss);
                            }
                        }}
                        style={StyleSheet.absoluteFill}
                    />
                    <View
                        pointerEvents="box-none"
                        style={[
                            styles.center,
                            {
                                paddingTop: insets.top,
                                paddingBottom: bottomPad,
                            },
                        ]}
                    >
                        <DialogCard
                            title={session.title}
                            message={session.message}
                            tone={session.tone}
                            buttons={session.buttons}
                            busyIndex={busyIndex}
                            width={width}
                            cardStyle={cardStyle}
                            iconStyle={iconStyle}
                            onButtonPress={handleButtonPress}
                        />
                    </View>
                </>
            )}
        </View>
    );
}

/** Dim scrim; iOS adds a light blur underneath, Android shows the scrim only. */
const DialogBackdrop = memo(function DialogBackdrop({
    progress,
}: {
    progress: SharedValue<number>;
}): React.ReactElement {
    const scrimStyle = useAnimatedStyle(() => ({
        opacity: progress.value * SCRIM_OPACITY,
    }));
    const blurStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
    }));
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {Platform.OS === 'ios' && (
                <Animated.View style={[StyleSheet.absoluteFill, blurStyle]}>
                    <BlurView
                        tint="dark"
                        intensity={BLUR_INTENSITY}
                        blurReductionFactor={4}
                        style={StyleSheet.absoluteFill}
                    />
                </Animated.View>
            )}
            <Animated.View
                style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
            />
        </View>
    );
});

// ── Toast ───────────────────────────────────────────────────────────────────

function ToastHost(): React.ReactElement {
    const session = useSyncExternalStore(toastStoreSubscribe, getToastSession);
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();

    const progress = useSharedValue(0);
    const drag = useSharedValue(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleClosed = useCallback((): void => {
        toastStore.finishClose();
    }, []);

    const requestClose = useCallback((): void => {
        if (!toastStore.beginClose()) {
            return;
        }
        progress.value = withTiming(
            0,
            {
                duration: reduceMotion ? REDUCED_MS : CLOSE_MS,
                easing: CLOSE_EASING,
            },
            (finished): void => {
                'worklet';
                if (finished) {
                    scheduleOnRN(handleClosed);
                }
            },
        );
    }, [reduceMotion, progress, handleClosed]);

    useEffect((): (() => void) | undefined => {
        if (session === null) {
            return undefined;
        }
        progress.value = 0;
        drag.value = 0;
        progress.value = reduceMotion
            ? withTiming(1, { duration: REDUCED_MS })
            : withSpring(1, TOAST_SPRING);
        timerRef.current = setTimeout((): void => {
            timerRef.current = null;
            requestClose();
        }, session.duration);
        return (): void => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [session, reduceMotion, progress, drag, requestClose]);

    // Swipe up to dismiss; a short drag springs back into place.
    const responder = useMemo(
        () =>
            PanResponder.create({
                onMoveShouldSetPanResponder: (_event, gesture): boolean =>
                    gesture.dy < -4 &&
                    Math.abs(gesture.dy) > Math.abs(gesture.dx),
                onPanResponderMove: (_event, gesture): void => {
                    drag.value = Math.min(0, gesture.dy);
                },
                onPanResponderRelease: (_event, gesture): void => {
                    if (gesture.dy < TOAST_SWIPE_DISMISS) {
                        requestClose();
                        return;
                    }
                    drag.value = withSpring(0, TOAST_SPRING);
                },
                onPanResponderTerminate: (): void => {
                    drag.value = withSpring(0, TOAST_SPRING);
                },
            }),
        [drag, requestClose],
    );

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [
            {
                translateY:
                    interpolate(
                        progress.value,
                        [0, 1],
                        [-TOAST_ENTRY_SHIFT, 0],
                        'clamp',
                    ) + drag.value,
            },
        ],
    }));

    return (
        <View
            pointerEvents="box-none"
            style={[styles.toastLayer, { top: insets.top + 8 }]}
        >
            {session !== null && (
                <Animated.View
                    {...responder.panHandlers}
                    style={[styles.toastWrap, animatedStyle]}
                >
                    <ToastPill message={session.message} tone={session.tone} />
                </Animated.View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: OVERLAY_Z,
        elevation: OVERLAY_Z,
    },
    scrim: { backgroundColor: palette.background },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: CARD_SIDE_MARGIN,
    },
    toastLayer: {
        position: 'absolute',
        left: 16,
        right: 16,
        zIndex: TOAST_Z,
        elevation: TOAST_Z,
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    toastWrap: { alignItems: 'center' },
});
