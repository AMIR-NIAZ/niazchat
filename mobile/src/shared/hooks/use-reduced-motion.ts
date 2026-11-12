import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Tracks the OS "Reduce Motion" preference. Animations should collapse to an
 * instant state change when this is true.
 */
export function useReducedMotion(): boolean {
    const [enabled, setEnabled] = useState(false);

    useEffect((): (() => void) => {
        let active = true;
        AccessibilityInfo.isReduceMotionEnabled()
            .then((value): void => {
                if (active) {
                    setEnabled(value);
                }
            })
            .catch((): void => undefined);
        const subscription = AccessibilityInfo.addEventListener(
            'reduceMotionChanged',
            setEnabled,
        );
        return (): void => {
            active = false;
            subscription.remove();
        };
    }, []);

    return enabled;
}
