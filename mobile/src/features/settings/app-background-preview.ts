import { useSyncExternalStore } from 'react';

/**
 * Live (unsaved) blur/dim values for the Appearance preview only.
 *
 * Dragging a slider must not write to the appearance store on every tick: that
 * would re-render the whole app and hit AsyncStorage continuously. Instead the
 * sliders publish the in-flight values here, only the preview background
 * subscribes, and the store is written once on release.
 */
export interface AppBackgroundPreview {
    /** Stored blur fraction (0–1). */
    blur: number;
    /** Stored dim opacity (0–0.7). */
    dim: number;
}

let current: AppBackgroundPreview | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    listeners.forEach((listener): void => listener());
}

export function setAppBackgroundPreview(next: AppBackgroundPreview): void {
    if (
        current !== null &&
        current.blur === next.blur &&
        current.dim === next.dim
    ) {
        return;
    }
    current = { ...next };
    emit();
}

/** Drops the live values, so the preview falls back to the saved background. */
export function clearAppBackgroundPreview(): void {
    if (current === null) {
        return;
    }
    current = null;
    emit();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return (): void => {
        listeners.delete(listener);
    };
}

function getSnapshot(): AppBackgroundPreview | null {
    return current;
}

export function useAppBackgroundPreview(): AppBackgroundPreview | null {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
