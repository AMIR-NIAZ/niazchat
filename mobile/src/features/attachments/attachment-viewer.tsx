import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AccessibilityInfo,
    BackHandler,
    FlatList,
    StyleSheet,
    View,
    useWindowDimensions,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import type { PanGestureConfig } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { palette, spacing } from '../../shared/theme';
import { useReducedMotion } from '../../shared/hooks/use-reduced-motion';
import { measureInWindow, useContextPopup } from '../../shared/context-popup';
import type { ViewInstance } from '../../shared/context-popup';
import { getLocalVideoUri } from '../../shared/media-cache';
import type { ChatMessage } from '../messages/messages-model';
import { ViewerImagePage } from './viewer/image-page';
import { ViewerVideoPage, CHROME_IDLE_MS } from './viewer/video-page';
import {
    ViewerCaptionFooter,
    ViewerCaptionSheet,
    ViewerCounter,
    ViewerHeader,
} from './viewer/viewer-chrome';
import { buildViewerMenuItems } from './viewer/viewer-menu';
import { viewerPageLabel } from './viewer/viewer-model';
import type { ViewerItem, ViewerRect } from './viewer/viewer-model';
import { registerMediaViewerCloser } from './media-viewer-store';

/**
 * Telegram-style full-screen media viewer for one conversation.
 *
 * It is a plain overlay mounted at the root of the app (no `Modal`), inside
 * `MediaViewerProvider`, so it covers the whole screen while the shared context
 * popup host and the dialog host still paint above it — and the hero
 * transition starts from the real bubble rect.
 *
 * - Dark purple background with a near-black bottom gradient; no white anywhere.
 * - Horizontal pager over EVERY image and video of the chat, 12 px page gap,
 *   only the current ±1 pages mounted.
 * - Hero OPEN from the tapped tile; ONE dismiss animation (drag down/up, header
 *   close, hardware back) is played by `animateDismiss`. Single tap toggles the
 *   chrome, pinch/double-tap zoom on images (UI thread).
 * - Header (sender + date + ⋯ menu + close), counter pill and a caption footer
 *   that only exists when the message has text.
 * - Video pages play only verified local files and drive their own controls.
 *
 * The viewer never starts a video download by itself, never touches the cache
 * or download state machine, and closes itself when the picked action needs the
 * conversation (Forward, Go to message, Delete).
 */

export interface AttachmentViewerProps {
    /** Every image/video page of the conversation, oldest first (snapshot). */
    items: readonly ViewerItem[];
    /** Page to show first, already resolved by the opener. */
    initialIndex: number;
    /** Tapped tile rect in window coordinates, for the hero OPEN transition. */
    origin?: ViewerRect | null;
    onClose: () => void;
    onForward?: ((message: ChatMessage) => void) | undefined;
    onGoToMessage?: ((message: ChatMessage) => void) | undefined;
    onDelete?: ((message: ChatMessage) => void) | undefined;
    canDelete?: ((message: ChatMessage) => boolean) | undefined;
}

/** Drag distance / velocity that dismisses instead of springing back. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;
/** Drag distance that corresponds to a fully faded backdrop. */
const DISMISS_FADE = 300;
/** Session-only mute memory (the app's other players do not share it). */
let sessionMuted = false;

export function AttachmentViewer({
    items,
    initialIndex,
    origin,
    onClose,
    onForward,
    onGoToMessage,
    onDelete,
    canDelete,
}: AttachmentViewerProps): React.ReactElement {
    const window = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const popup = useContextPopup();

    const startIndex = Math.min(
        Math.max(0, initialIndex),
        Math.max(0, items.length - 1),
    );

    const [index, setIndex] = useState(startIndex);
    const [chromeVisible, setChromeVisible] = useState(true);
    const [zoomed, setZoomed] = useState(false);
    const [captionOpen, setCaptionOpen] = useState(false);
    const [footerHeight, setFooterHeight] = useState(0);
    const [muted, setMuted] = useState(sessionMuted);
    const [playing, setPlaying] = useState(false);
    /** True from the moment a close starts: pauses the video while exiting. */
    const [dismissing, setDismissing] = useState(false);

    const pagerRef = useRef<FlatList<ViewerItem>>(null);
    const menuButtonRef = useRef<ViewInstance | null>(null);
    const closingRef = useRef(false);
    const openedRef = useRef(false);
    const afterCloseRef = useRef<(() => void) | null>(null);

    const current = items[index];
    const hasCaption = (current?.message.content?.trim() ?? '') !== '';
    const chromeShown = chromeVisible && !zoomed && !captionOpen;
    const total = items.length;

    // ── clocks ───────────────────────────────────────────────────────────
    const hero = useSharedValue(0);
    const chrome = useSharedValue(0);
    const counter = useSharedValue(0);
    const dismissY = useSharedValue(0);
    const dismissProgress = useSharedValue(0);
    /** 1 once the dismiss animation owns the screen (makes closes idempotent). */
    const closing = useSharedValue(0);

    /**
     * Where the media grows from on OPEN: the tapped tile's centre and width.
     * Without a usable origin (deleted row, off-screen bubble) it is a plain
     * 0.96 scale.
     */
    const heroFrom = useMemo((): {
        scale: number;
        x: number;
        y: number;
        known: boolean;
    } => {
        const usable =
            origin !== undefined &&
            origin !== null &&
            origin.width > 8 &&
            origin.height > 8 &&
            origin.y < window.height &&
            origin.y + origin.height > 0;
        if (!usable || origin === undefined || origin === null) {
            return { scale: 0.96, x: 0, y: 0, known: false };
        }
        const scale = Math.min(1.4, Math.max(0.2, origin.width / window.width));
        return {
            scale,
            x: origin.x + origin.width / 2 - window.width / 2,
            y: origin.y + origin.height / 2 - window.height / 2,
            known: true,
        };
    }, [origin, window.height, window.width]);

    const finishClose = useCallback((): void => {
        const after = afterCloseRef.current;
        afterCloseRef.current = null;
        if (after !== null) {
            after();
            return;
        }
        onClose();
    }, [onClose]);

    /**
     * THE close animation. Every trigger — the drag gesture, the header close
     * button, hardware back, the menu actions and a deleted last item — runs
     * exactly this: the media slides out vertically and scales to 0.85 while
     * the backdrop and the chrome fade to 0, then `finishClose` unmounts the
     * overlay. `closing` makes repeat requests a no-op.
     *
     * `direction` is -1 for an upward swipe, 1 (down) for a programmatic close;
     * the drag release and a button press travel the same distance with the
     * same timing, so both look identical.
     */
    const animateDismiss = useCallback(
        (direction: number = 1): void => {
            'worklet';
            if (closing.value === 1) return;
            closing.value = 1;
            const duration = reduceMotion ? 90 : 220;
            chrome.value = withTiming(0, { duration });
            counter.value = withTiming(0, { duration });
            // Reduced motion: fade only, no travel.
            if (!reduceMotion) {
                dismissY.value = withTiming(direction * window.height, {
                    duration,
                    easing: Easing.out(Easing.quad),
                });
            }
            dismissProgress.value = withTiming(
                1,
                { duration, easing: Easing.out(Easing.quad) },
                (finished): void => {
                    'worklet';
                    if (finished) scheduleOnRN(finishClose);
                },
            );
        },
        [
            chrome,
            closing,
            counter,
            dismissProgress,
            dismissY,
            finishClose,
            reduceMotion,
            window.height,
        ],
    );

    /** A playing video stops the instant the exit starts. */
    const pauseForDismiss = useCallback((): void => {
        setDismissing(true);
    }, []);

    /** Programmatic close: same animation, down, then runs `after` if given. */
    const close = useCallback(
        (after?: () => void): void => {
            if (closingRef.current) return;
            closingRef.current = true;
            afterCloseRef.current = after ?? null;
            pauseForDismiss();
            animateDismiss(1);
        },
        [animateDismiss, pauseForDismiss],
    );

    const toggleChrome = useCallback((): void => {
        setChromeVisible((visible) => !visible);
    }, []);

    // Open: grow from the tile, fade the chrome in right after.
    useEffect((): void => {
        if (openedRef.current) return;
        openedRef.current = true;
        // A fresh open starts from a clean exit state.
        closing.value = 0;
        closingRef.current = false;
        dismissY.value = 0;
        dismissProgress.value = 0;
        hero.value = withTiming(1, {
            duration: reduceMotion ? 90 : 260,
            easing: Easing.out(Easing.cubic),
        });
        chrome.value = withDelay(
            reduceMotion ? 0 : 90,
            withTiming(1, { duration: reduceMotion ? 90 : 180 }),
        );
    }, [chrome, closing, dismissProgress, dismissY, hero, reduceMotion]);

    // Chrome fade/slide on every show/hide.
    useEffect((): void => {
        const duration = reduceMotion ? 90 : 180;
        chrome.value = withTiming(chromeShown ? 1 : 0, {
            duration,
            easing: Easing.out(Easing.quad),
        });
    }, [chromeShown, chrome, reduceMotion]);

    // Pages can leave while the viewer is open (a deleted message): never keep
    // an index that no longer has a page behind it.
    useEffect((): void => {
        setIndex((previous) =>
            previous < items.length ? previous : Math.max(0, items.length - 1),
        );
    }, [items.length]);

    // `closeMediaViewer()` (the module store) must run this exit, not unmount
    // the viewer on the spot.
    useEffect((): (() => void) => {
        registerMediaViewerCloser(close);
        return (): void => registerMediaViewerCloser(null);
    }, [close]);

    // Android back runs the very same dismiss as a swipe, and always consumes
    // the event: a second press mid-animation is ignored by `close`/`closing`.
    useEffect((): (() => void) => {
        const subscription = BackHandler.addEventListener(
            'hardwareBackPress',
            (): boolean => {
                close();
                return true;
            },
        );
        return (): void => subscription.remove();
    }, [close]);

    // Counter pill: flashes in on a page change, hides itself after 1.5 s.
    useEffect((): (() => void) => {
        if (total <= 1) return (): void => undefined;
        counter.value = withTiming(1, { duration: reduceMotion ? 90 : 160 });
        const timer = setTimeout((): void => {
            counter.value = withTiming(0, { duration: 220 });
        }, 1500);
        return (): void => clearTimeout(timer);
    }, [counter, index, reduceMotion, total]);

    // Playing video: the chrome hides itself after a moment of inactivity.
    useEffect((): (() => void) => {
        if (!playing || !chromeVisible) return (): void => undefined;
        const timer = setTimeout(
            (): void => setChromeVisible(false),
            CHROME_IDLE_MS,
        );
        return (): void => clearTimeout(timer);
    }, [playing, chromeVisible]);

    const handlePageChange = useCallback(
        (next: number): void => {
            setIndex((previous) => {
                if (previous === next) return previous;
                setPlaying(false);
                return next;
            });
            AccessibilityInfo.announceForAccessibility(
                viewerPageLabel(items[next], next, items.length),
            );
        },
        [items],
    );

    const onViewableItemsChangedRef = useRef(handlePageChange);
    onViewableItemsChangedRef.current = handlePageChange;
    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 60,
    }).current;
    const onViewableItemsChanged = useRef(
        (info: {
            viewableItems: Array<{ index?: number | undefined }>;
        }): void => {
            const first = info.viewableItems[0];
            if (typeof first?.index === 'number') {
                onViewableItemsChangedRef.current(first.index);
            }
        },
    ).current;

    const toggleMute = useCallback((): void => {
        setMuted((value) => {
            sessionMuted = !value;
            return !value;
        });
    }, []);

    const onVideoPlayingChange = useCallback((isPlaying: boolean): void => {
        setPlaying(isPlaying);
    }, []);

    // ── menu ─────────────────────────────────────────────────────────────
    const openMenu = useCallback((): void => {
        const item = items[index];
        if (item === undefined) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
            (): void => undefined,
        );
        const attachmentId = item.attachment.id;
        const fileReady =
            attachmentId === null ||
            item.attachment.kind !== 'video' ||
            getLocalVideoUri(attachmentId) !== null;
        void measureInWindow(menuButtonRef).then((anchor): void => {
            if (anchor === null) return;
            popup.open({
                anchor,
                sourceKey: `viewer-${item.key}`,
                align: 'start',
                actions: buildViewerMenuItems(
                    item,
                    {
                        canDelete:
                            item.message.status === 'sent' &&
                            (canDelete?.(item.message) ?? false),
                        onForward: (target): void => {
                            close((): void => onForward?.(target.message));
                        },
                        onGoToMessage: (target): void => {
                            close((): void => onGoToMessage?.(target.message));
                        },
                        onDelete: (target): void => {
                            close((): void => onDelete?.(target.message));
                        },
                    },
                    fileReady,
                ),
                accessibilityLabel: 'Media actions',
            });
        });
    }, [
        canDelete,
        close,
        index,
        items,
        onDelete,
        onForward,
        onGoToMessage,
        popup,
    ]);

    // ── drag to dismiss (only at 1x, and not from the caption sheet) ─────
    const dragGesture = usePanGesture(
        useMemo<PanGestureConfig>(
            () => ({
                enabled: !zoomed && !captionOpen,
                activeOffsetY: [-14, 14],
                failOffsetX: [-24, 24],
                onUpdate: (event): void => {
                    'worklet';
                    const travel = event.translationY;
                    dismissY.value = travel;
                    dismissProgress.value = Math.min(
                        1,
                        Math.abs(travel) / DISMISS_FADE,
                    );
                },
                onDeactivate: (event): void => {
                    'worklet';
                    const shouldDismiss =
                        Math.abs(event.translationY) > DISMISS_DISTANCE ||
                        Math.abs(event.velocityY) > DISMISS_VELOCITY;
                    if (!shouldDismiss) {
                        dismissY.value = withSpring(0, {
                            damping: 20,
                            stiffness: 240,
                        });
                        dismissProgress.value = withTiming(0, {
                            duration: 160,
                        });
                        return;
                    }
                    scheduleOnRN(pauseForDismiss);
                    animateDismiss(event.translationY < 0 ? -1 : 1);
                },
            }),
            [
                animateDismiss,
                captionOpen,
                dismissProgress,
                dismissY,
                pauseForDismiss,
                zoomed,
            ],
        ),
    );

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: hero.value * (1 - dismissProgress.value * 0.9),
    }));

    const contentStyle = useAnimatedStyle(() => {
        const progress = hero.value;
        const scale =
            heroFrom.scale +
            (1 - heroFrom.scale) * progress -
            0.15 * dismissProgress.value;
        return {
            opacity: heroFrom.known ? 1 : progress,
            transform: [
                { translateX: heroFrom.x * (1 - progress) },
                {
                    translateY: heroFrom.y * (1 - progress) + dismissY.value,
                },
                { scale },
            ],
        };
    });

    const headerStyle = useAnimatedStyle(() => ({
        opacity: chrome.value,
        transform: [{ translateY: interpolate(chrome.value, [0, 1], [-8, 0]) }],
    }));
    const footerStyle = useAnimatedStyle(() => ({
        opacity: chrome.value,
        transform: [{ translateY: interpolate(chrome.value, [0, 1], [8, 0]) }],
    }));
    const counterStyle = useAnimatedStyle(() => ({
        opacity: counter.value,
    }));

    const renderItem = useCallback(
        ({
            item,
            index: pageIndex,
        }: ListRenderItemInfo<ViewerItem>): React.ReactElement => {
            const active = pageIndex === index;
            // Only the current page and its two neighbours are mounted.
            if (Math.abs(pageIndex - index) > 1) {
                return (
                    <View
                        style={{ width: window.width, height: window.height }}
                    />
                );
            }
            if (item.attachment.kind === 'video') {
                return (
                    <ViewerVideoPage
                        item={item}
                        active={active}
                        width={window.width}
                        height={window.height}
                        muted={muted}
                        onToggleMute={toggleMute}
                        onTap={toggleChrome}
                        onPlayingChange={onVideoPlayingChange}
                        paused={dismissing}
                        controlsBottom={
                            hasCaption ? footerHeight : insets.bottom
                        }
                    />
                );
            }
            return (
                <ViewerImagePage
                    item={item}
                    active={active}
                    width={window.width}
                    height={window.height}
                    onTap={toggleChrome}
                    onZoomChange={setZoomed}
                />
            );
        },
        [
            dismissing,
            footerHeight,
            hasCaption,
            index,
            insets.bottom,
            muted,
            onVideoPlayingChange,
            toggleChrome,
            toggleMute,
            window.height,
            window.width,
        ],
    );

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
                <LinearGradient
                    colors={[palette.background, palette.background, '#030207']}
                    locations={[0, 0.55, 1]}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>

            <GestureDetector gesture={dragGesture}>
                <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
                    <FlatList
                        ref={pagerRef}
                        data={items}
                        horizontal={true}
                        pagingEnabled={true}
                        scrollEnabled={!zoomed}
                        showsHorizontalScrollIndicator={false}
                        keyExtractor={(item): string => item.key}
                        renderItem={renderItem}
                        initialScrollIndex={startIndex}
                        getItemLayout={(
                            _data,
                            pageIndex,
                        ): {
                            length: number;
                            offset: number;
                            index: number;
                        } => ({
                            length: window.width,
                            offset: window.width * pageIndex,
                            index: pageIndex,
                        })}
                        viewabilityConfig={viewabilityConfig}
                        onViewableItemsChanged={onViewableItemsChanged}
                        initialNumToRender={3}
                        maxToRenderPerBatch={3}
                        windowSize={3}
                        removeClippedSubviews={false}
                    />
                </Animated.View>
            </GestureDetector>

            {/* top chrome */}
            <Animated.View
                pointerEvents={chromeShown ? 'box-none' : 'none'}
                style={[styles.topChrome, headerStyle]}
            >
                {current !== undefined && (
                    <ViewerHeader
                        item={current}
                        insetTop={insets.top}
                        onClose={(): void => close()}
                        onMenu={openMenu}
                        menuButtonRef={menuButtonRef}
                    />
                )}
                {total > 1 && (
                    <Animated.View
                        style={[styles.counterWrap, counterStyle]}
                        pointerEvents="none"
                    >
                        <ViewerCounter
                            label={viewerPageLabel(current, index, total)}
                        />
                    </Animated.View>
                )}
            </Animated.View>

            {/* bottom chrome: caption only */}
            {current !== undefined && hasCaption && (
                <Animated.View
                    pointerEvents={chromeShown ? 'box-none' : 'none'}
                    style={[styles.bottomChrome, footerStyle]}
                    onLayout={(event): void =>
                        setFooterHeight(event.nativeEvent.layout.height)
                    }
                >
                    <ViewerCaptionFooter
                        item={current}
                        insetBottom={insets.bottom}
                        onExpand={(): void => setCaptionOpen(true)}
                    />
                </Animated.View>
            )}

            {captionOpen && current !== undefined && (
                <ViewerCaptionSheet
                    item={current}
                    insetBottom={insets.bottom}
                    onClose={(): void => setCaptionOpen(false)}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    topChrome: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
    },
    counterWrap: { alignItems: 'center', marginTop: spacing.xxs },
    bottomChrome: {
        position: 'absolute',
        bottom: 0,
        start: 0,
        end: 0,
    },
});
