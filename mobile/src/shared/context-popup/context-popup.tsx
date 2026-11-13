import {
    createContext,
    memo,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import {
    BackHandler,
    Keyboard,
    Platform,
    Pressable,
    StyleSheet,
    View,
    useWindowDimensions,
} from 'react-native';
import type { ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
    Easing,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { palette } from '../theme';
import { ContextMenuCard } from './menu-card';
import type { ContextMenuItem } from './menu-card';
import { ReactionPill } from './reaction-pill';
import type { ContextPopupReaction } from './reaction-pill';
import { computePopupLayout } from './popup-layout';
import type {
    PopupAlign,
    PopupLayout,
    PopupPlacement,
    PopupRect,
} from './popup-layout';

/**
 * Floating context popups as a plain overlay — no `Modal`, no per-frame state.
 *
 * The host is a sibling of the navigator, absolutely positioned, so it covers
 * the screens AND their own headers. Opening measures nothing and waits for
 * nothing: the caller already has the source rect (`measureInWindow`), every
 * piece of chrome has a fixed size, so the whole stack is computed
 * synchronously in `open()` and committed in ONE `setSession`.
 *
 * ONE Reanimated shared value (`progress`, 0 = at rest over the source,
 * 1 = fully open) drives every layer on the UI thread. The list underneath is
 * never touched: the popup draws a static copy of the pressed element over it
 * and simply removes it at the end, so opening/closing re-renders nothing.
 */

/** The single entrance clock (no spring, no overshoot). */
export const POPUP_OPEN_MS = 200;
/** The single exit clock. */
export const POPUP_CLOSE_MS = 160;
/** Reduce Motion: opacity only, no movement. */
const REDUCED_POPUP_MS = 90;
/** Android backdrop: a near-opaque scrim (no blur in a separate window). */
export const POPUP_SCRIM_OPACITY = 0.84;
/** iOS backdrop: a light blur + faint dim underneath the scrim. */
export const POPUP_BACKDROP_BLUR_INTENSITY = 24;
const POPUP_BACKDROP_DIM = 'rgba(0, 0, 0, 0.13)';

/** Layers start appearing at these shares of the single clock. */
const MENU_INPUT_MAX = 0.5;
const REACTION_INPUT_MAX = 0.6;
/** How far the popups travel into place (px). */
const POPUP_ENTRY_SHIFT = 8;

export interface ContextPopupConfig {
    /** Source rect in WINDOW coordinates (`measureInWindow`). */
    anchor: PopupRect;
    align?: PopupAlign;
    /** Static copy of the pressed element, drawn over the live one. */
    preview?: ReactNode;
    /** Quick reactions, rendered in a pill above (or below) the copy. */
    reactions?: readonly ContextPopupReaction[];
    /** Action rows. Tapping one closes the popup, then runs its `onPress`. */
    actions?: readonly ContextMenuItem[];
    /** Centered card instead of the anchor stack (e.g. the reactor list). */
    center?: { content: ReactNode; width: number; height: number };
    accessibilityLabel?: string;
    /** Runs after the popup is gone (never before). */
    onClose?: () => void;
}

export interface ContextPopupController {
    open: (config: ContextPopupConfig) => void;
    /** Closes the popup; `after` runs once it is gone, never before. */
    close: (after?: () => void) => void;
    isOpen: () => boolean;
}

interface PopupSession {
    config: ContextPopupConfig;
    layout: PopupLayout;
    reduceMotion: boolean;
}

const ContextPopupContext = createContext<ContextPopupController | null>(null);

export function useContextPopup(): ContextPopupController {
    const controller = useContext(ContextPopupContext);
    if (controller === null) {
        throw new Error(
            'useContextPopup must be used inside a ContextPopupProvider.',
        );
    }
    return controller;
}

function absoluteRect(rect: PopupRect): ViewStyle {
    return {
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
    };
}

export function ContextPopupProvider({
    children,
}: {
    children: ReactNode;
}): React.ReactElement {
    const window = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const progress = useSharedValue(0);
    const [session, setSession] = useState<PopupSession | null>(null);
    /**
     * The ONE piece of session state, mirrored in a ref so `open`/`close` can
     * stay identity-stable (a changing controller would re-render every screen
     * that calls `useContextPopup`).
     */
    const sessionRef = useRef<PopupSession | null>(null);
    const closingRef = useRef(false);
    /** Action picked in the menu, run once the popup is gone. */
    const pendingActionRef = useRef<(() => void) | null>(null);
    const windowRef = useRef(window);
    windowRef.current = window;
    const insetsRef = useRef(insets);
    insetsRef.current = insets;
    const reduceMotionRef = useRef(reduceMotion);
    reduceMotionRef.current = reduceMotion;
    /** Keyboard height, kept in a ref: it must be readable synchronously. */
    const keyboardRef = useRef(0);

    useEffect((): (() => void) => {
        const show = Keyboard.addListener('keyboardDidShow', (event): void => {
            keyboardRef.current = event.endCoordinates.height;
        });
        const hide = Keyboard.addListener('keyboardDidHide', (): void => {
            keyboardRef.current = 0;
        });
        return (): void => {
            show.remove();
            hide.remove();
        };
    }, []);

    /** Drops the session and runs the picked action immediately after it. */
    const finishClose = useCallback((): void => {
        const config = sessionRef.current?.config ?? null;
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        closingRef.current = false;
        sessionRef.current = null;
        setSession(null);
        action?.();
        config?.onClose?.();
    }, []);

    const close = useCallback(
        (after?: () => void): void => {
            if (sessionRef.current === null || closingRef.current) {
                return;
            }
            closingRef.current = true;
            if (after !== undefined) {
                pendingActionRef.current = after;
            }
            progress.value = withTiming(
                0,
                {
                    duration: reduceMotionRef.current
                        ? REDUCED_POPUP_MS
                        : POPUP_CLOSE_MS,
                    easing: Easing.bezier(0.4, 0, 0.2, 1),
                },
                (finished): void => {
                    'worklet';
                    if (finished) {
                        runOnJS(finishClose)();
                    }
                },
            );
        },
        [finishClose, progress],
    );

    const open = useCallback(
        (config: ContextPopupConfig): void => {
            const layout = computePopupLayout({
                anchor: config.anchor,
                window: {
                    width: windowRef.current.width,
                    height: windowRef.current.height,
                },
                insets: {
                    top: insetsRef.current.top,
                    bottom: insetsRef.current.bottom,
                    left: insetsRef.current.left,
                    right: insetsRef.current.right,
                },
                keyboardHeight: keyboardRef.current,
                itemCount: config.actions?.length ?? 0,
                reactionCount: config.reactions?.length ?? 0,
                align: config.align ?? 'start',
                centerSize:
                    config.center === undefined
                        ? null
                        : {
                              width: config.center.width,
                              height: config.center.height,
                          },
            });
            const next: PopupSession = {
                config,
                layout,
                reduceMotion: reduceMotionRef.current,
            };
            sessionRef.current = next;
            closingRef.current = false;
            pendingActionRef.current = null;
            // Reset before the commit, so a re-open never paints one frame of
            // the previous (finished) timeline.
            progress.value = 0;
            setSession(next);
        },
        [progress],
    );

    // Entrance: starts once, after the fully computed session is committed.
    useEffect((): void => {
        if (session === null) {
            return;
        }
        progress.value = withTiming(1, {
            duration: session.reduceMotion ? REDUCED_POPUP_MS : POPUP_OPEN_MS,
            easing: Easing.out(Easing.cubic),
        });
    }, [session, progress]);

    const isOpen = session !== null;
    useEffect((): (() => void) | undefined => {
        if (!isOpen) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener(
            'hardwareBackPress',
            (): boolean => {
                close();
                return true;
            },
        );
        return (): void => {
            subscription.remove();
        };
    }, [isOpen, close]);

    const controller = useMemo<ContextPopupController>(
        () => ({
            open,
            close,
            isOpen: (): boolean => sessionRef.current !== null,
        }),
        [open, close],
    );

    /** Menu/reaction taps: remember the action, close, then run it. */
    const select = useCallback(
        (action: () => void): void => {
            if (closingRef.current) {
                return;
            }
            pendingActionRef.current = action;
            close();
        },
        [close],
    );

    const menuItems = useMemo(
        () =>
            session?.config.actions?.map(
                (item): ContextMenuItem => ({
                    ...item,
                    onPress: (): void => select(item.onPress),
                }),
            ) ?? null,
        [session, select],
    );
    const reactionItems = useMemo(
        () =>
            session?.config.reactions?.map(
                (reaction): ContextPopupReaction => ({
                    ...reaction,
                    onPress: (): void => select(reaction.onPress),
                }),
            ) ?? null,
        [session, select],
    );

    const previewRect: PopupRect | null =
        session === null || session.config.preview === undefined
            ? null
            : {
                  x: session.layout.previewX,
                  // Reduce Motion never moves the copy: it stays on the source.
                  y: session.reduceMotion
                      ? session.config.anchor.y
                      : session.layout.previewY,
                  width: session.layout.previewWidth,
                  height: session.layout.previewHeight,
              };
    const previewShift =
        session === null || session.reduceMotion
            ? 0
            : session.config.anchor.y - session.layout.previewY;

    return (
        <ContextPopupContext.Provider value={controller}>
            {children}
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
                        <PopupBackdrop
                            progress={progress}
                            reduceMotion={session.reduceMotion}
                        />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Close menu"
                            onPress={(): void => close()}
                            style={StyleSheet.absoluteFill}
                        />
                        {session.layout.center !== null &&
                        session.config.center !== undefined ? (
                            <PopupCenter
                                progress={progress}
                                rect={session.layout.center}
                                reduceMotion={session.reduceMotion}
                            >
                                {session.config.center.content}
                            </PopupCenter>
                        ) : (
                            <>
                                {previewRect !== null && (
                                    <PopupPreview
                                        progress={progress}
                                        rect={previewRect}
                                        shift={previewShift}
                                        reduceMotion={session.reduceMotion}
                                    >
                                        {session.config.preview}
                                    </PopupPreview>
                                )}
                                {session.layout.reactions !== null &&
                                    reactionItems !== null && (
                                        <PopupReactions
                                            progress={progress}
                                            rect={session.layout.reactions}
                                            placement={session.layout.placement}
                                            reduceMotion={session.reduceMotion}
                                        >
                                            <ReactionPill
                                                reactions={reactionItems}
                                                width={
                                                    session.layout.reactions
                                                        .width
                                                }
                                            />
                                        </PopupReactions>
                                    )}
                                {session.layout.menu !== null &&
                                    menuItems !== null && (
                                        <PopupMenu
                                            progress={progress}
                                            rect={session.layout.menu}
                                            placement={session.layout.placement}
                                            reduceMotion={session.reduceMotion}
                                        >
                                            <ContextMenuCard
                                                items={menuItems}
                                                accessibilityLabel={
                                                    session.config
                                                        .accessibilityLabel
                                                }
                                            />
                                        </PopupMenu>
                                    )}
                            </>
                        )}
                    </>
                )}
            </View>
        </ContextPopupContext.Provider>
    );
}

/** Full-screen backdrop: scrim on Android, blur + dim on iOS. */
const PopupBackdrop = memo(function PopupBackdrop({
    progress,
    reduceMotion,
}: {
    progress: SharedValue<number>;
    reduceMotion: boolean;
}): React.ReactElement {
    const animatedStyle = useAnimatedStyle(() => ({
        opacity: progress.value * POPUP_SCRIM_OPACITY,
    }));
    const blurStyle = useAnimatedStyle(() => ({
        opacity: reduceMotion ? 1 : progress.value,
    }));
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {Platform.OS === 'ios' && (
                <Animated.View style={[StyleSheet.absoluteFill, blurStyle]}>
                    <BlurView
                        tint="dark"
                        intensity={POPUP_BACKDROP_BLUR_INTENSITY}
                        blurReductionFactor={4}
                        style={StyleSheet.absoluteFill}
                    />
                    <View style={[StyleSheet.absoluteFill, styles.dim]} />
                </Animated.View>
            )}
            <Animated.View
                style={[StyleSheet.absoluteFill, styles.scrim, animatedStyle]}
            />
        </View>
    );
});

/**
 * Static copy of the pressed element, exactly over the live one at
 * `progress = 0` and translated up into its lifted slot at 1. Only a
 * transform is animated, so the copy is painted on every frame.
 */
const PopupPreview = memo(function PopupPreview({
    progress,
    rect,
    shift,
    reduceMotion,
    children,
}: {
    progress: SharedValue<number>;
    rect: PopupRect;
    shift: number;
    reduceMotion: boolean;
    children: ReactNode;
}): React.ReactElement {
    const animatedStyle = useAnimatedStyle(() => {
        if (reduceMotion || shift === 0) {
            return {};
        }
        return {
            transform: [
                {
                    translateY: interpolate(
                        progress.value,
                        [0, 1],
                        [shift, 0],
                        'clamp',
                    ),
                },
            ],
        };
    }, [shift, reduceMotion]);
    return (
        <Animated.View
            pointerEvents="none"
            style={[absoluteRect(rect), styles.preview, animatedStyle]}
        >
            {children}
        </Animated.View>
    );
});

const PopupReactions = memo(function PopupReactions({
    progress,
    rect,
    placement,
    reduceMotion,
    children,
}: {
    progress: SharedValue<number>;
    rect: PopupRect;
    placement: PopupPlacement;
    reduceMotion: boolean;
    children: ReactNode;
}): React.ReactElement {
    const animatedStyle = useAnimatedStyle(() => {
        if (reduceMotion) {
            return { opacity: progress.value };
        }
        return {
            opacity: interpolate(
                progress.value,
                [0, REACTION_INPUT_MAX],
                [0, 1],
                'clamp',
            ),
            transform: [
                {
                    scale: interpolate(
                        progress.value,
                        [0, REACTION_INPUT_MAX],
                        [0.88, 1],
                        'clamp',
                    ),
                },
            ],
        };
    }, [reduceMotion]);
    return (
        <Animated.View
            style={[
                absoluteRect(rect),
                placement === 'below' ? styles.originBottom : styles.originTop,
                animatedStyle,
            ]}
        >
            {children}
        </Animated.View>
    );
});

const PopupMenu = memo(function PopupMenu({
    progress,
    rect,
    placement,
    reduceMotion,
    children,
}: {
    progress: SharedValue<number>;
    rect: PopupRect;
    placement: PopupPlacement;
    reduceMotion: boolean;
    children: ReactNode;
}): React.ReactElement {
    const animatedStyle = useAnimatedStyle(() => {
        if (reduceMotion) {
            return { opacity: progress.value };
        }
        return {
            opacity: interpolate(
                progress.value,
                [0, MENU_INPUT_MAX],
                [0, 1],
                'clamp',
            ),
            transform: [
                {
                    translateY: interpolate(
                        progress.value,
                        [0, MENU_INPUT_MAX],
                        [
                            placement === 'below'
                                ? POPUP_ENTRY_SHIFT
                                : -POPUP_ENTRY_SHIFT,
                            0,
                        ],
                        'clamp',
                    ),
                },
                {
                    scale: interpolate(
                        progress.value,
                        [0, MENU_INPUT_MAX],
                        [0.9, 1],
                        'clamp',
                    ),
                },
            ],
        };
    }, [reduceMotion, placement]);
    return (
        <Animated.View
            style={[
                absoluteRect(rect),
                // Grow from the edge that faces the copy.
                placement === 'below' ? styles.originTop : styles.originBottom,
                animatedStyle,
            ]}
        >
            {children}
        </Animated.View>
    );
});

const PopupCenter = memo(function PopupCenter({
    progress,
    rect,
    reduceMotion,
    children,
}: {
    progress: SharedValue<number>;
    rect: PopupRect;
    reduceMotion: boolean;
    children: ReactNode;
}): React.ReactElement {
    const animatedStyle = useAnimatedStyle(() => {
        if (reduceMotion) {
            return { opacity: progress.value };
        }
        return {
            opacity: progress.value,
            transform: [
                {
                    scale: interpolate(
                        progress.value,
                        [0, 1],
                        [0.96, 1],
                        'clamp',
                    ),
                },
            ],
        };
    }, [reduceMotion]);
    return (
        <Animated.View style={[absoluteRect(rect), animatedStyle]}>
            {children}
        </Animated.View>
    );
});

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        elevation: 1000,
    },
    scrim: { backgroundColor: palette.background },
    dim: { backgroundColor: POPUP_BACKDROP_DIM },
    preview: { overflow: 'hidden' },
    originTop: { transformOrigin: 'top' },
    originBottom: { transformOrigin: 'bottom' },
});
