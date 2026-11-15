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
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import type { AnimatedStyle, SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
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
 * ONE timing clock (`progress`, 0 = at rest over the source, 1 = fully open)
 * drives the scrim, the copy and the opacity of every layer on the UI thread.
 * A second clock (`pop`, plus its delayed menu twin) springs ONLY the reaction
 * pill and the action menu into place on open; both return with plain timing on
 * close. The list underneath is never re-rendered, re-laid out or scrolled: the
 * popup draws a static copy of the pressed element over it while the live one
 * is hidden through an opacity-only shared value (`usePopupHidden`), so the
 * SAME element appears to lift. Opening/closing re-renders nothing.
 */

/** The single progress clock (scrim, copy, opacity). */
export const POPUP_OPEN_MS = 220;
/** The single exit clock. */
export const POPUP_CLOSE_MS = 160;
/** Reduce Motion: opacity only, no movement. */
const REDUCED_POPUP_MS = 90;
/**
 * The `pop` clock: only the reaction pill and the action menu scale/travel on
 * OPEN. A damped spring is what makes the "bubble" feel alive; it overshoots
 * by a few percent and settles, unlike `progress`.
 */
const POP_SPRING = { damping: 14, stiffness: 260, mass: 0.7 };
/** The menu starts this long after the pill, so they do not pop as one slab. */
const POP_STAGGER_MS = 30;
/** Pill/menu scale at rest before the spring arrives (~14% pop). */
const POP_SCALE_FROM = 0.86;
/**
 * The copy's own bubble spring: the lifted message pops up, overshoots a few
 * percent and settles at this scale while the popup is open. It is a SEPARATE
 * clock from the pill/menu one (different damping), so the copy can feel soft
 * without changing how the menus enter.
 */
const COPY_POP_SPRING = { damping: 11, stiffness: 240, mass: 0.7 };
const COPY_POP_SCALE_TO = 1.035;
/** Android backdrop: a near-opaque scrim (no blur in a separate window). */
export const POPUP_SCRIM_OPACITY = 0.84;
/** iOS backdrop: a light blur + faint dim underneath the scrim. */
export const POPUP_BACKDROP_BLUR_INTENSITY = 24;
const POPUP_BACKDROP_DIM = 'rgba(0, 0, 0, 0.13)';

/** The popup opacity reaches 1 at these shares of the progress clock. */
const MENU_INPUT_MAX = 0.5;
const REACTION_INPUT_MAX = 0.6;
/** How far the popups travel into place (px). */
const POPUP_ENTRY_SHIFT = 8;

export interface ContextPopupConfig {
    /** Source rect in WINDOW coordinates (`measureInWindow`). */
    anchor: PopupRect;
    /**
     * Stable key of the pressed element (the message `key`, or
     * `chat:<id>`): the live element carrying this key is hidden while the
     * popup draws its copy, so the original does not stay behind the lift.
     */
    sourceKey: string;
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
/**
 * Key of the live element the popup is currently replacing. Read on the UI
 * thread by every row through `usePopupHidden`, so hiding/revealing the source
 * never re-renders the list.
 */
const PopupHiddenContext = createContext<SharedValue<string | null> | null>(
    null,
);

/**
 * Opacity-only animated style for the live source of a popup copy.
 *
 * The row is not unmounted and no layout prop changes: only its opacity goes to
 * 0 while the popup's copy stands exactly on top of it, which makes the lift
 * read as the same element moving instead of a duplicate appearing. The
 * comparison happens in `useAnimatedStyle` (UI thread), so opening/closing a
 * popup passes no new props and does not re-render a single row.
 */
export function usePopupHidden(key: string): AnimatedStyle<ViewStyle> {
    const hiddenKey = useContext(PopupHiddenContext);
    return useAnimatedStyle(() => {
        if (hiddenKey === null) {
            // Rendered outside the provider (tests, standalone previews).
            return {};
        }
        return { opacity: hiddenKey.value === key ? 0 : 1 };
    }, [hiddenKey, key]);
}

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
    /** Spring clock for the reactions pill (OPEN only; timing on close). */
    const pop = useSharedValue(0);
    /** The lifted copy's own spring (bubble scale; OPEN only). */
    const copyPop = useSharedValue(0);
    /** The same clock for the menu, started ~30 ms later. */
    const menuPop = useSharedValue(0);
    /**
     * Key of the live element that is currently hidden because the popup draws
     * its copy. UI-thread only: no React state, so no list row re-renders.
     */
    const hiddenKey = useSharedValue<string | null>(null);
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
        // A new popup opened between the reveal frame being scheduled and it
        // running: that open reset `closingRef`, and it owns the session now.
        if (!closingRef.current) {
            return;
        }
        const config = sessionRef.current?.config ?? null;
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        closingRef.current = false;
        sessionRef.current = null;
        // Safety net for any path that drops a session without the exit
        // animation having run its own reveal step.
        hiddenKey.value = null;
        setSession(null);
        action?.();
        config?.onClose?.();
    }, [hiddenKey]);

    /**
     * Exit finished: `progress` is back at 0, so the copy sits exactly on the
     * live element again. Reveal it FIRST, then drop the session on the next
     * frame — never the other way around, or one frame would paint the copy
     * over a revealed row (a flicker), or unmount it while the row is hidden.
     */
    const revealSource = useCallback((): void => {
        hiddenKey.value = null;
        requestAnimationFrame((): void => {
            finishClose();
        });
    }, [finishClose, hiddenKey]);

    const close = useCallback(
        (after?: () => void): void => {
            if (sessionRef.current === null || closingRef.current) {
                return;
            }
            closingRef.current = true;
            if (after !== undefined) {
                pendingActionRef.current = after;
            }
            const duration = reduceMotionRef.current
                ? REDUCED_POPUP_MS
                : POPUP_CLOSE_MS;
            const easing = Easing.bezier(0.4, 0, 0.2, 1);
            // Close is a plain timing clock: no spring, no overshoot. The
            // `pop`/`copyPop` values only drive transforms; opacity comes from
            // `progress`, and `progress` alone is what finishes the close.
            progress.value = withTiming(
                0,
                { duration, easing },
                (finished): void => {
                    'worklet';
                    if (finished) {
                        scheduleOnRN(revealSource);
                    }
                },
            );
            pop.value = withTiming(0, { duration, easing });
            menuPop.value = withTiming(0, { duration, easing });
            // The copy settles back to exactly 1 with the same timing clock.
            copyPop.value = withTiming(0, { duration, easing });
        },
        [revealSource, progress, pop, menuPop, copyPop],
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
            pop.value = 0;
            menuPop.value = 0;
            copyPop.value = 0;
            setSession(next);
        },
        [progress, pop, menuPop, copyPop],
    );

    // Entrance: starts once, after the fully computed session is committed.
    // `progress` fades/moves everything (scrim, copy, opacity); `pop` only
    // springs the pill and menu into place. Reduce Motion keeps opacity alone.
    useEffect((): void => {
        if (session === null) {
            return;
        }
        // Hide the live source only AFTER the commit, when its copy is already
        // painted on the same rect at `progress = 0` — so the swap is
        // invisible. A centered sheet draws no copy, so there is nothing to
        // replace and the list stays untouched.
        hiddenKey.value =
            session.config.preview === undefined
                ? null
                : session.config.sourceKey;
        if (session.reduceMotion) {
            pop.value = 0;
            menuPop.value = 0;
            copyPop.value = 0;
        } else {
            pop.value = withSpring(1, POP_SPRING);
            menuPop.value = withDelay(
                POP_STAGGER_MS,
                withSpring(1, POP_SPRING),
            );
            // The lifted message itself pops like a soft bubble and rests at
            // a few percent above its anchor size.
            copyPop.value = withSpring(1, COPY_POP_SPRING);
        }
        progress.value = withTiming(1, {
            duration: session.reduceMotion ? REDUCED_POPUP_MS : POPUP_OPEN_MS,
            easing: Easing.out(Easing.cubic),
        });
    }, [session, progress, pop, menuPop, copyPop, hiddenKey]);

    // The host can go away with a session still hidden (root remount, dev
    // reload): never leave a row invisible behind a popup that no longer exists.
    useEffect(
        (): (() => void) => (): void => {
            hiddenKey.value = null;
        },
        [hiddenKey],
    );

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
    // The copy grows from the edge its own bubble is anchored to: mine (align
    // end) grow from the right, others from the left, everything else centred.
    const previewOrigin: ViewStyle['transformOrigin'] =
        session?.config.align === 'end'
            ? 'right center'
            : session?.config.align === 'start'
              ? 'left center'
              : 'center';

    return (
        <ContextPopupContext.Provider value={controller}>
            <PopupHiddenContext.Provider value={hiddenKey}>
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
                                            copyPop={copyPop}
                                            rect={previewRect}
                                            shift={previewShift}
                                            origin={previewOrigin}
                                            reduceMotion={session.reduceMotion}
                                        >
                                            {session.config.preview}
                                        </PopupPreview>
                                    )}
                                    {session.layout.reactions !== null &&
                                        reactionItems !== null && (
                                            <PopupReactions
                                                progress={progress}
                                                pop={pop}
                                                rect={session.layout.reactions}
                                                placement={
                                                    session.layout.placement
                                                }
                                                reduceMotion={
                                                    session.reduceMotion
                                                }
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
                                                pop={menuPop}
                                                rect={session.layout.menu}
                                                placement={
                                                    session.layout.placement
                                                }
                                                reduceMotion={
                                                    session.reduceMotion
                                                }
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
            </PopupHiddenContext.Provider>
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
 * `progress = 0` / `copyPop = 0` and translated up into its lifted slot at 1.
 *
 * Two UI-thread clocks: `progress` owns the translateY (the lift) and
 * `copyPop` owns the scale (the bubble softness) — scale `1 → 1.035` with a spring that
 * overshoots, resting slightly larger than the anchor while open and returning
 * to exactly 1 on close. Only transforms are animated, so the copy is painted
 * on every frame and its text never reflows.
 */
const PopupPreview = memo(function PopupPreview({
    progress,
    copyPop,
    rect,
    shift,
    origin,
    reduceMotion,
    children,
}: {
    progress: SharedValue<number>;
    /** Bubble spring: 0 = exact anchor size, 1 = rested pop. */
    copyPop: SharedValue<number>;
    rect: PopupRect;
    shift: number;
    /** Scale origin: the bubble's own anchored edge. */
    origin: ViewStyle['transformOrigin'];
    reduceMotion: boolean;
    children: ReactNode;
}): React.ReactElement {
    const animatedStyle = useAnimatedStyle(() => {
        if (reduceMotion) {
            // Reduce Motion: no lift, no pop, no scale.
            return {};
        }
        return {
            transform: [
                ...(shift === 0
                    ? []
                    : [
                          {
                              translateY: interpolate(
                                  progress.value,
                                  [0, 1],
                                  [shift, 0],
                                  'clamp',
                              ),
                          },
                      ]),
                {
                    scale: interpolate(
                        copyPop.value,
                        [0, 1],
                        [1, COPY_POP_SCALE_TO],
                        'extend',
                    ),
                },
            ],
        };
    }, [shift, reduceMotion, copyPop]);
    return (
        <Animated.View
            pointerEvents="none"
            style={[
                // NOT clipped: the copy is the full bubble at the anchor box,
                // so the pop can grow a few px and the footer never gets cut.
                absoluteRect(rect),
                { transformOrigin: origin },
                animatedStyle,
            ]}
        >
            {children}
        </Animated.View>
    );
});

const PopupReactions = memo(function PopupReactions({
    progress,
    pop,
    rect,
    placement,
    reduceMotion,
    children,
}: {
    progress: SharedValue<number>;
    pop: SharedValue<number>;
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
            // Opacity is always the progress clock (clamped at 1); the spring
            // only scales/travels, so it can overshoot without flashing.
            opacity: interpolate(
                progress.value,
                [0, REACTION_INPUT_MAX],
                [0, 1],
                'clamp',
            ),
            transform: [
                {
                    // The pill sits above the copy, so it enters from above.
                    translateY: interpolate(
                        pop.value,
                        [0, 1],
                        [-POPUP_ENTRY_SHIFT, 0],
                        'extend',
                    ),
                },
                {
                    scale: interpolate(
                        pop.value,
                        [0, 1],
                        [POP_SCALE_FROM, 1],
                        'extend',
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
    pop,
    rect,
    placement,
    reduceMotion,
    children,
}: {
    progress: SharedValue<number>;
    pop: SharedValue<number>;
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
                    // The menu sits below the copy, so it enters from below.
                    translateY: interpolate(
                        pop.value,
                        [0, 1],
                        [
                            placement === 'below'
                                ? POPUP_ENTRY_SHIFT
                                : -POPUP_ENTRY_SHIFT,
                            0,
                        ],
                        'extend',
                    ),
                },
                {
                    scale: interpolate(
                        pop.value,
                        [0, 1],
                        [POP_SCALE_FROM, 1],
                        'extend',
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
    originTop: { transformOrigin: 'top' },
    originBottom: { transformOrigin: 'bottom' },
});
