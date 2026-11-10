import { useSyncExternalStore } from 'react';

/**
 * Upload progress lives OUTSIDE the TanStack Query cache: a progress tick must
 * not re-render every consumer of the conversation query. Components subscribe
 * per pending attachment with `useUploadProgress`.
 */
const progress = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string): void {
    const set = listeners.get(key);
    if (set === undefined) {
        return;
    }
    for (const listener of set) {
        listener();
    }
}

export function setUploadProgress(key: string, value: number): void {
    const next = Math.max(0, Math.min(1, value));
    if (progress.get(key) === next) {
        return;
    }
    progress.set(key, next);
    emit(key);
}

export function clearUploadProgress(key: string): void {
    if (!progress.has(key)) {
        return;
    }
    progress.delete(key);
    emit(key);
}

export function getUploadProgress(key: string): number {
    return progress.get(key) ?? 0;
}

export function subscribeUploadProgress(
    key: string,
    listener: () => void,
): () => void {
    let set = listeners.get(key);
    if (set === undefined) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
    return (): void => {
        set.delete(listener);
        if (set.size === 0) {
            listeners.delete(key);
        }
    };
}

/** Progress (0..1) of one pending attachment key. */
export function useUploadProgress(key: string): number {
    return useSyncExternalStore(
        (listener): (() => void) => subscribeUploadProgress(key, listener),
        (): number => getUploadProgress(key),
        (): number => 0,
    );
}
