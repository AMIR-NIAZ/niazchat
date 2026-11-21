import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Defers a callback until the native `Modal` that is closing has finished
 * dismissing.
 *
 * The shared dialog/toast host lives inside the app tree, so opening it while
 * a native `Modal` (an action sheet, for example) is still on screen would
 * leave the two overlays stacked - or hide the dialog behind the Modal.
 * iOS reports the end of the dismissal through `Modal`'s `onDismiss`; Android
 * has no such event, so the callback runs on the next frame. Whichever path
 * takes the pending callback first runs it, so it never runs twice.
 */
export function useAfterModalClose(): {
    /** Queue `run` to execute once the Modal has closed. */
    deferUntilDismissed: (run: () => void) => void;
    /** Pass to the Modal's `onDismiss` prop. */
    onModalDismiss: () => void;
} {
    const pendingRef = useRef<(() => void) | null>(null);

    const onModalDismiss = useCallback((): void => {
        const run = pendingRef.current;
        if (run === null) {
            return;
        }
        pendingRef.current = null;
        run();
    }, []);

    const deferUntilDismissed = useCallback(
        (run: () => void): void => {
            pendingRef.current = run;
            if (Platform.OS !== 'ios') {
                requestAnimationFrame(onModalDismiss);
            }
        },
        [onModalDismiss],
    );

    return { deferUntilDismissed, onModalDismiss };
}
