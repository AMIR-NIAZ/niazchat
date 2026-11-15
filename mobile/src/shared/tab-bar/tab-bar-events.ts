import { useEffect } from 'react';

/**
 * Tiny module-level bus for "the active tab was pressed again". The chat list
 * listens for it to scroll back to the top; no context and no re-render of the
 * bar or the list are needed.
 */

type HomeReselectListener = () => void;

const listeners = new Set<HomeReselectListener>();

export function requestHomeTabReselect(): void {
    listeners.forEach((listener): void => {
        listener();
    });
}

export function subscribeHomeTabReselect(
    listener: HomeReselectListener,
): () => void {
    listeners.add(listener);
    return (): void => {
        listeners.delete(listener);
    };
}

/** Subscribes for the lifetime of the calling screen. */
export function useHomeTabReselect(listener: HomeReselectListener): void {
    useEffect(
        (): (() => void) => subscribeHomeTabReselect(listener),
        [listener],
    );
}
