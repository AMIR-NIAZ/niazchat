import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';
import type { PopupRect } from './popup-layout';

/** Host instance of a `<View>` (RN 0.87+ typing). */
export type ViewInstance = ComponentRef<typeof View>;

/**
 * Measures a view in WINDOW coordinates. Resolves `null` for a detached view, a
 * zero-size view or a non-finite measurement, so callers never build a popup
 * around a garbage rect.
 */
export function measureInWindow(
    ref: RefObject<ViewInstance | null>,
): Promise<PopupRect | null> {
    return new Promise((resolve) => {
        const node = ref.current;
        if (node === null) {
            resolve(null);
            return;
        }
        try {
            node.measureInWindow((x, y, width, height): void => {
                if (
                    !Number.isFinite(x) ||
                    !Number.isFinite(y) ||
                    !Number.isFinite(width) ||
                    !Number.isFinite(height) ||
                    width <= 0 ||
                    height <= 0
                ) {
                    resolve(null);
                    return;
                }
                resolve({ x, y, width, height });
            });
        } catch {
            resolve(null);
        }
    });
}
