import { useCallback, useRef, useState } from 'react';
import type {
    FlatList,
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
} from 'react-native';

/**
 * Visibility of the "scroll to latest" button.
 *
 * The distance to the newest message is measured against the list viewport:
 * - inverted list (newest at offset 0): distance = contentOffset.y
 * - normal list (newest at the end):    distance = contentHeight - viewport - y
 *
 * Two thresholds give hysteresis so the button never flickers at the boundary:
 * it appears past 60% of the viewport (min 250 px) and disappears once the user
 * is back within 30% (min 120 px).
 */
const SHOW_VIEWPORT_RATIO = 0.6;
const SHOW_MIN_PX = 250;
const HIDE_VIEWPORT_RATIO = 0.3;
const HIDE_MIN_PX = 120;
/** Close enough to count as "at the newest message". */
const AT_BOTTOM_PX = 8;
/** Extra `scrollToEnd` corrections for variable row heights. */
const MAX_CORRECTIONS = 3;

export interface ScrollMetrics {
    offsetY: number;
    contentHeight: number;
    viewportHeight: number;
}

export function distanceToNewest(
    inverted: boolean,
    metrics: ScrollMetrics,
): number {
    if (inverted) {
        return Math.max(0, metrics.offsetY);
    }
    return Math.max(
        0,
        metrics.contentHeight - metrics.viewportHeight - metrics.offsetY,
    );
}

export interface ScrollToBottomButtonApi {
    visible: boolean;
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    onLayout: (event: LayoutChangeEvent) => void;
    onContentSizeChange: (width: number, height: number) => void;
    /** Smooth-scrolls to the newest message (with a bounded correction). */
    scrollToBottom: () => void;
    /** Stops any pending correction, e.g. when the user starts dragging. */
    cancelScrollToBottom: () => void;
}

export interface UseScrollToBottomButtonOptions<T> {
    listRef: React.RefObject<FlatList<T> | null>;
    inverted: boolean;
    /** Called when the button hides because the newest message is reached. */
    onBottomReached?: () => void;
}

export function useScrollToBottomButton<T>(
    options: UseScrollToBottomButtonOptions<T>,
): ScrollToBottomButtonApi {
    const { listRef, inverted } = options;
    const offsetRef = useRef(0);
    const contentHeightRef = useRef(0);
    const viewportHeightRef = useRef(0);
    const visibleRef = useRef(false);
    const correctingRef = useRef(false);
    const correctionsRef = useRef(0);
    const bottomHandlerRef = useRef(options.onBottomReached);
    bottomHandlerRef.current = options.onBottomReached;
    const [visible, setVisible] = useState(false);

    const measure = useCallback(
        (): number =>
            distanceToNewest(inverted, {
                offsetY: offsetRef.current,
                contentHeight: contentHeightRef.current,
                viewportHeight: viewportHeightRef.current,
            }),
        [inverted],
    );

    const scrollToNewest = useCallback(
        (animated: boolean): void => {
            const list = listRef.current;
            if (list === null) {
                return;
            }
            if (inverted) {
                list.scrollToOffset({ offset: 0, animated });
            } else {
                list.scrollToEnd({ animated });
            }
        },
        [inverted, listRef],
    );

    // Ref-driven: called on every scroll/layout/content-size event, but only
    // commits state when visibility actually flips (never per frame).
    const recompute = useCallback((): void => {
        const viewport = viewportHeightRef.current;
        const content = contentHeightRef.current;
        const scrollable = content > viewport + 1;
        const distance = measure();
        const showAt = Math.max(SHOW_MIN_PX, viewport * SHOW_VIEWPORT_RATIO);
        const hideAt = Math.max(HIDE_MIN_PX, viewport * HIDE_VIEWPORT_RATIO);

        let next = visibleRef.current;
        if (!scrollable) {
            next = false;
        } else if (!next && distance > showAt) {
            next = true;
        } else if (next && distance < hideAt) {
            next = false;
        }
        if (next === visibleRef.current) {
            return;
        }
        visibleRef.current = next;
        setVisible(next);
        if (!next) {
            bottomHandlerRef.current?.();
        }
    }, [measure]);

    /** Retries a short `scrollToEnd` after the list measures the new rows. */
    const applyCorrection = useCallback((): void => {
        if (!correctingRef.current) {
            return;
        }
        if (measure() <= AT_BOTTOM_PX) {
            correctingRef.current = false;
            return;
        }
        if (correctionsRef.current >= MAX_CORRECTIONS) {
            correctingRef.current = false;
            return;
        }
        correctionsRef.current += 1;
        scrollToNewest(false);
    }, [measure, scrollToNewest]);

    const onScroll = useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
            const { contentOffset, contentSize, layoutMeasurement } =
                event.nativeEvent;
            offsetRef.current = contentOffset.y;
            if (contentSize.height > 0) {
                contentHeightRef.current = contentSize.height;
            }
            if (layoutMeasurement.height > 0) {
                viewportHeightRef.current = layoutMeasurement.height;
            }
            if (correctingRef.current && measure() <= AT_BOTTOM_PX) {
                correctingRef.current = false;
            }
            recompute();
        },
        [measure, recompute],
    );

    const onLayout = useCallback(
        (event: LayoutChangeEvent): void => {
            viewportHeightRef.current = event.nativeEvent.layout.height;
            recompute();
            applyCorrection();
        },
        [applyCorrection, recompute],
    );

    const onContentSizeChange = useCallback(
        (_width: number, height: number): void => {
            contentHeightRef.current = height;
            recompute();
            applyCorrection();
        },
        [applyCorrection, recompute],
    );

    const scrollToBottom = useCallback((): void => {
        correctingRef.current = true;
        correctionsRef.current = 0;
        scrollToNewest(true);
    }, [scrollToNewest]);

    const cancelScrollToBottom = useCallback((): void => {
        correctingRef.current = false;
    }, []);

    return {
        visible,
        onScroll,
        onLayout,
        onContentSizeChange,
        scrollToBottom,
        cancelScrollToBottom,
    };
}
