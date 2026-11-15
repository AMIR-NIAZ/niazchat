import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Shared geometry for the floating pill tab bar. Every tab screen reserves
 * `useTabBarInset()` at the bottom of its scroll content so nothing hides
 * behind the floating pill.
 */

export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_SIDE_MARGIN = 16;
export const TAB_BAR_BOTTOM_MIN = 12;
export const TAB_BAR_BOTTOM_OFFSET = 8;
/** Breathing room between the last list row and the pill. */
export const TAB_BAR_CONTENT_GAP = 16;
export const TAB_BAR_MAX_WIDTH = 420;

/** Space a scroll view must leave at the bottom for the pill. */
export function useTabBarInset(): number {
    const insets = useSafeAreaInsets();
    return (
        TAB_BAR_HEIGHT +
        Math.max(insets.bottom, TAB_BAR_BOTTOM_MIN) +
        TAB_BAR_BOTTOM_OFFSET +
        TAB_BAR_CONTENT_GAP
    );
}
