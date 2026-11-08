import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

interface AndroidKeyboardGeometry {
    /** Keyboard area the window does not already exclude — i.e. the padding still needed. */
    inset: number;
    /** True between `keyboardDidShow` and `keyboardDidHide`. */
    open: boolean;
}

interface AndroidKeyboardState extends AndroidKeyboardGeometry {
    /** Attach to the container that spans the application window. */
    onContainerLayout: (event: LayoutChangeEvent) => void;
}

const CLOSED: AndroidKeyboardGeometry = { inset: 0, open: false };
/** Sub-pixel layout noise must not trigger extra renders. */
const EPSILON = 0.5;

/**
 * Android keyboard inset that works both when Android resizes the window for
 * the IME (`adjustResize` on Android 14 and older) and when it does not
 * (edge-to-edge / Android 15+, where the IME simply overlays the window).
 *
 * Android gives no direct "did you get resized?" flag to JS, and
 * `Dimensions.get('window')` does not answer it reliably: it is rebuilt from
 * `WindowMetrics` minus the system-bar insets of the moment, so on a device
 * that *does* resize for the IME it can still report the unshrunk height (or a
 * height offset by a navigation bar the IME hides). Deriving the resize from
 * that guess is what applied the full IME height on top of an already-shrunk
 * window — right on one device, stretching the layout on another.
 *
 * So this hook measures instead of infers. The container passed through
 * `onContainerLayout` fills the application window (edge-to-edge, no native
 * header above it), therefore its bottom edge *is* the window bottom, in the
 * same coordinate space as the IME top from `keyboardDidShow`. Whatever part
 * of the IME sits above that edge is still covered by the keyboard:
 *
 * - window not resized  → container bottom == screen bottom → full IME height
 * - window resized      → container bottom == IME top      → 0, nothing added
 *
 * The keyboard is consequently accounted for exactly once on every device, and
 * a late native resize simply shrinks the value back to 0 through `onLayout`.
 *
 * iOS keeps its existing `KeyboardAvoidingView` behavior: this hook is a no-op
 * there.
 *
 * @param bottomInset Bottom system-bar inset (`useSafeAreaInsets().bottom`).
 *   Only used by the development diagnostics, never by the layout math.
 */
export function useAndroidKeyboardInset(bottomInset = 0): AndroidKeyboardState {
    const [state, setState] = useState<AndroidKeyboardGeometry>(CLOSED);
    const committedRef = useRef<AndroidKeyboardGeometry>(CLOSED);
    const containerHeightRef = useRef<number | null>(null);
    const closedHeightRef = useRef<number | null>(null);
    const keyboardTopRef = useRef<number | null>(null);
    const keyboardHeightRef = useRef(0);
    const openRef = useRef(false);
    const frameRef = useRef<number | null>(null);
    const bottomInsetRef = useRef(bottomInset);

    useEffect((): void => {
        bottomInsetRef.current = bottomInset;
    }, [bottomInset]);

    const commit = useCallback((next: AndroidKeyboardGeometry): void => {
        const previous = committedRef.current;
        if (
            previous.open === next.open &&
            Math.abs(previous.inset - next.inset) <= EPSILON
        ) {
            return;
        }
        committedRef.current = next;
        setState(next);
    }, []);

    const update = useCallback((): void => {
        const keyboardTop = keyboardTopRef.current;
        const containerHeight = containerHeightRef.current;
        if (
            !openRef.current ||
            keyboardTop === null ||
            containerHeight === null
        ) {
            return;
        }

        const covered = Math.max(0, containerHeight - keyboardTop);
        if (__DEV__) {
            const closedHeight = closedHeightRef.current;
            console.log('[kbd]', {
                windowHeightClosed: closedHeight,
                windowHeightOpen: containerHeight,
                keyboardHeight: keyboardHeightRef.current,
                keyboardTop,
                containerBottom: containerHeight,
                bottomSystemInset: bottomInsetRef.current,
                nativeWindowResized:
                    closedHeight !== null &&
                    containerHeight < closedHeight - EPSILON,
                extraAvoidance: covered,
                composerBottom: containerHeight - covered,
            });
        }
        commit({ inset: covered, open: true });
    }, [commit]);

    /**
     * A resizing window can settle one or two frames *after* `keyboardDidShow`.
     * Measuring after those frames keeps the first paint from applying the IME
     * height to a window that is about to shrink (`onLayout` corrects it too).
     */
    const scheduleUpdate = useCallback((): void => {
        if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current);
        }
        frameRef.current = requestAnimationFrame((): void => {
            frameRef.current = requestAnimationFrame((): void => {
                frameRef.current = null;
                update();
            });
        });
    }, [update]);

    const onContainerLayout = useCallback(
        (event: LayoutChangeEvent): void => {
            if (Platform.OS !== 'android') {
                return;
            }
            const height = event.nativeEvent.layout.height;
            containerHeightRef.current = height;
            if (openRef.current) {
                // The window just resized under the IME: recompute the overlap.
                update();
            } else if (!Keyboard.isVisible()) {
                // Only a genuinely keyboard-closed layout is a usable baseline.
                closedHeightRef.current = height;
            }
        },
        [update],
    );

    useEffect((): (() => void) | undefined => {
        if (Platform.OS !== 'android') {
            return undefined;
        }

        // Navigating into a chat while the IME is still up: seed from the
        // singleton so the first layout can already avoid the keyboard.
        const metrics = Keyboard.metrics();
        if (metrics !== null && metrics !== undefined && Keyboard.isVisible()) {
            keyboardTopRef.current = metrics.screenY;
            keyboardHeightRef.current = metrics.height;
            openRef.current = true;
        }

        const showSubscription = Keyboard.addListener(
            'keyboardDidShow',
            (event) => {
                keyboardTopRef.current = event.endCoordinates.screenY;
                keyboardHeightRef.current = event.endCoordinates.height;
                openRef.current = true;
                scheduleUpdate();
            },
        );

        const hideSubscription = Keyboard.addListener(
            'keyboardDidHide',
            (): void => {
                openRef.current = false;
                keyboardTopRef.current = null;
                keyboardHeightRef.current = 0;
                if (frameRef.current !== null) {
                    cancelAnimationFrame(frameRef.current);
                    frameRef.current = null;
                }
                if (__DEV__) {
                    console.log('[kbd]', { phase: 'hide' });
                }
                commit(CLOSED);
            },
        );

        return (): void => {
            showSubscription.remove();
            hideSubscription.remove();
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [commit, scheduleUpdate]);

    return {
        inset: state.inset,
        open: state.open,
        onContainerLayout,
    };
}
