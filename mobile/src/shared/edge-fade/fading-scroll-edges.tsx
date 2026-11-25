import { Children, cloneElement, useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated';
import { MaskedViewSafe } from './edge-fade-view';
import { MAX_FADE_RATIO } from './mask-stops';

/** Which edges to fade. */
export type FadeEdges = 'top' | 'bottom' | 'both';

/** Default visible ramp of each fade band, below the chrome inset (px). */
export const DEFAULT_FADE_HEIGHT = 28;

const MASK_FILL: ViewStyle = { flex: 1 };
const MASK_CLIP: ViewStyle = { overflow: 'hidden' };
const MASK_OPAQUE = 'rgba(0,0,0,1)';
const MASK_CLEAR = 'rgba(0,0,0,0)';

/**
 * Band height in px: the chrome/inset the fade has to reach through plus the
 * visible ramp, capped so two bands can never cover the content.
 */
function bandHeight(
    inset: number,
    fadeHeight: number,
    viewportHeight: number,
): number {
    'worklet';
    if (viewportHeight <= 0) {
        // Nothing measured yet: keep the band closed (no fade).
        return 0;
    }
    return Math.min(inset + fadeHeight, viewportHeight * MAX_FADE_RATIO);
}

/** 0 = no fade needed at this edge, 1 = fully open. */
function clampProgress(value: number): number {
    'worklet';
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(Math.max(value, 0), 1);
}

/** Scroll distance from the top edge, as a 0..1 fade progress. */
function topProgress(
    scrollY: number,
    inset: number,
    fadeHeight: number,
    viewportHeight: number,
): number {
    'worklet';
    const band = bandHeight(inset, fadeHeight, viewportHeight);
    return band > 0 ? clampProgress(scrollY / band) : 0;
}

/** Remaining scroll distance to the end, as a 0..1 fade progress. */
function bottomProgress(
    scrollY: number,
    contentHeight: number,
    inset: number,
    fadeHeight: number,
    viewportHeight: number,
): number {
    'worklet';
    const band = bandHeight(inset, fadeHeight, viewportHeight);
    if (band <= 0) {
        return 0;
    }
    const maxScroll = Math.max(contentHeight - viewportHeight, 0);
    return clampProgress((maxScroll - scrollY) / band);
}

/**
 * The slice of a scroll container's props the wrapper reads or injects.
 * `onScroll` is deliberately `unknown`: the real prop is the Reanimated
 * handler type, which is not what a plain ScrollView accepts — the docs above
 * require the animated variant.
 */
interface FadingScrollChildProps {
    onScroll?: unknown;
    scrollEventThrottle?: number;
    onContentSizeChange?: (width: number, height: number) => void;
    contentContainerStyle?: StyleProp<ViewStyle>;
    scrollIndicatorInsets?: { top?: number; bottom?: number };
}

interface FadingScrollEdgesProps {
    /** Edges to fade. Default: `'both'`. */
    edges?: FadeEdges;
    /**
     * Visible ramp below the top chrome, in px (default 28). The full band is
     * `topInset + fadeHeight`, so the fade stays translucent all the way from
     * the physical top edge out past the header.
     */
    fadeHeight?: number;
    /**
     * Top space kept free for the status bar + header, in px. It is where the
     * fade is fully open and it is injected as the content's `paddingTop`, so
     * at rest the first item starts right below the header while scrolled
     * content dissolves under it.
     */
    topInset?: number;
    /**
     * Bottom space kept free for the safe area + tab bar, in px. Injected as
     * the content's `paddingBottom`, so the last item can clear the bottom
     * chrome while it is faded there.
     */
    bottomInset?: number;
    style?: StyleProp<ViewStyle>;
    /**
     * A single scrollable element: `Animated.ScrollView`, `Animated.FlatList`,
     * `Animated.SectionList`, or `Animated.createAnimatedComponent(FlashList)`.
     *
     * It must be the Reanimated (or otherwise animated) variant: the wrapper
     * injects a UI-thread scroll handler, which a plain `ScrollView` would run
     * as an ordinary JS callback. The wrapper owns `onScroll` and
     * `scrollEventThrottle`; `onContentSizeChange` is chained.
     */
    children: ReactElement<FadingScrollChildProps>;
}

/**
 * Scroll-aware soft fade of the wrapped content at its top and bottom edges.
 *
 * Same visual technique as `EdgeFadeView` (the chat list): an alpha *mask*
 * with a vertical transparent→opaque gradient, so the Screen's ambient
 * background (circles, gradients, photos) shows through the faded strip
 * instead of a solid theme-colored band.
 *
 * Unlike `EdgeFadeView`, the bands are driven by the live scroll position on
 * the UI thread (`useAnimatedScrollHandler` + Reanimated styles, no JS state
 * and no re-render of the list):
 *  - the top band grows in as the content scrolls away from the top,
 *  - the bottom band grows in while more content remains and is gone once the
 *    end is reached.
 * At either end the band is zero-height, so the first/last item is never
 * dimmed at rest.
 *
 * The container measures itself for the viewport height and listens to the
 * child's content size, so "reached the end" needs no extra wiring. Each band
 * is capped (like `EdgeFadeView`) so two bands can never cover the content.
 *
 * Full-bleed by design, like the chat list: the scroll container is expected
 * to fill the whole screen (`Screen` with both insets off, header absolutely
 * positioned over it). `topInset` / `bottomInset` are the chrome heights the
 * fade has to reach through; the wrapper injects them as the content's
 * `paddingTop` / `paddingBottom` (and the scroll indicators' insets) so the
 * padding and the fade geometry can never drift apart.
 *
 * Works in RTL (vertical ramp only) and on any app background, because nothing
 * is painted: the content itself is masked. Assumes a non-inverted scroll
 * container (offset 0 = top).
 */
export function FadingScrollEdges({
    edges = 'both',
    fadeHeight = DEFAULT_FADE_HEIGHT,
    topInset = 0,
    bottomInset = 0,
    style,
    children,
}: FadingScrollEdgesProps): React.ReactElement {
    const [viewportHeight, setViewportHeight] = useState(0);
    const scrollY = useSharedValue(0);
    const contentHeight = useSharedValue(0);

    const fadeTop = edges === 'top' || edges === 'both';
    const fadeBottom = edges === 'bottom' || edges === 'both';

    const onLayout = useCallback((event: LayoutChangeEvent): void => {
        const height = event.nativeEvent.layout.height;
        if (height <= 0) {
            return;
        }
        setViewportHeight((previous): number =>
            Math.abs(previous - height) < 0.5 ? previous : height,
        );
    }, []);

    // UI thread only: no `onScroll` JS callback, no state update per frame.
    const onScroll = useAnimatedScrollHandler({
        onScroll: (event): void => {
            scrollY.value = event.contentOffset.y;
        },
    });

    // Viewport height is read from state (changes on rotation, not per frame).
    // `progress` is 0 at the edge (no fade) and 1 once the band is fully open.
    const topBandStyle = useAnimatedStyle(() => ({
        height:
            bandHeight(topInset, fadeHeight, viewportHeight) *
            (fadeTop
                ? topProgress(
                      scrollY.value,
                      topInset,
                      fadeHeight,
                      viewportHeight,
                  )
                : 0),
    }));

    const bottomBandStyle = useAnimatedStyle(() => ({
        height:
            bandHeight(bottomInset, fadeHeight, viewportHeight) *
            (fadeBottom
                ? bottomProgress(
                      scrollY.value,
                      contentHeight.value,
                      bottomInset,
                      fadeHeight,
                      viewportHeight,
                  )
                : 0),
    }));

    // The opaque core between the two bands: it starts exactly where the top
    // band ends and stops where the bottom band starts, so an unopened band
    // leaves the edge fully opaque (no fade over content that is not scrolled).
    const coreStyle = useAnimatedStyle(() => {
        const topBand = bandHeight(topInset, fadeHeight, viewportHeight);
        const bottomBand = bandHeight(bottomInset, fadeHeight, viewportHeight);
        return {
            top:
                topBand *
                (fadeTop
                    ? topProgress(
                          scrollY.value,
                          topInset,
                          fadeHeight,
                          viewportHeight,
                      )
                    : 0),
            bottom:
                bottomBand *
                (fadeBottom
                    ? bottomProgress(
                          scrollY.value,
                          contentHeight.value,
                          bottomInset,
                          fadeHeight,
                          viewportHeight,
                      )
                    : 0),
        };
    });

    // The child may have its own content-size callback (it is called on the JS
    // thread anyway); read it through a ref so it is never stale.
    const childContentSizeHandler = useRef<
        ((width: number, height: number) => void) | undefined
    >(undefined);
    const child = Children.only(children);
    childContentSizeHandler.current = child.props.onContentSizeChange;

    const scrollable = cloneElement(child, {
        onScroll,
        scrollEventThrottle: 16,
        // Injected last: these win over the child's own values, so the content
        // always clears the same chrome the mask fades through.
        contentContainerStyle: [
            child.props.contentContainerStyle,
            { paddingTop: topInset, paddingBottom: bottomInset },
        ],
        scrollIndicatorInsets: { top: topInset, bottom: bottomInset },
        onContentSizeChange: (width: number, height: number): void => {
            contentHeight.value = height;
            childContentSizeHandler.current?.(width, height);
        },
    });

    const masked = (
        <View style={MASK_FILL} collapsable={false}>
            {scrollable}
        </View>
    );

    // No native mask view (lib missing), or on web: the web build of
    // masked-view renders the mask element INSTEAD of the content, so the
    // scrollable has to render unmasked there rather than disappear.
    if (MaskedViewSafe === undefined || Platform.OS === 'web') {
        return (
            <View style={[styles.root, style]} onLayout={onLayout}>
                {masked}
            </View>
        );
    }

    return (
        <View style={[styles.root, style]} onLayout={onLayout}>
            <MaskedViewSafe
                style={MASK_FILL}
                maskElement={
                    <View
                        style={[MASK_FILL, MASK_CLIP]}
                        collapsable={false}
                        pointerEvents="none"
                    >
                        <Animated.View style={[styles.core, coreStyle]} />
                        {fadeTop && (
                            <Animated.View
                                style={[styles.topBand, topBandStyle]}
                            >
                                <LinearGradient
                                    colors={[MASK_CLEAR, MASK_OPAQUE]}
                                    start={{ x: 0.5, y: 0 }}
                                    end={{ x: 0.5, y: 1 }}
                                    style={MASK_FILL}
                                />
                            </Animated.View>
                        )}
                        {fadeBottom && (
                            <Animated.View
                                style={[styles.bottomBand, bottomBandStyle]}
                            >
                                <LinearGradient
                                    colors={[MASK_OPAQUE, MASK_CLEAR]}
                                    start={{ x: 0.5, y: 0 }}
                                    end={{ x: 0.5, y: 1 }}
                                    style={MASK_FILL}
                                />
                            </Animated.View>
                        )}
                    </View>
                }
            >
                {masked}
            </MaskedViewSafe>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    core: {
        position: 'absolute',
        start: 0,
        end: 0,
        top: 0,
        bottom: 0,
        backgroundColor: MASK_OPAQUE,
    },
    topBand: {
        position: 'absolute',
        start: 0,
        end: 0,
        top: 0,
        overflow: 'hidden',
    },
    bottomBand: {
        position: 'absolute',
        start: 0,
        end: 0,
        bottom: 0,
        overflow: 'hidden',
    },
});
