/**
 * Cleanup hooks run on logout (stop audio/video playback, abort uploads, clear
 * timers). Features register themselves so the auth layer does not need to
 * import them (avoids cycles and keeps logout independent of feature code).
 */
type SessionCleanup = () => void;

const cleanups = new Set<SessionCleanup>();

export function registerSessionCleanup(cleanup: SessionCleanup): () => void {
    cleanups.add(cleanup);
    return () => {
        cleanups.delete(cleanup);
    };
}

/** Runs every cleanup; one throwing hook never blocks the rest. */
export function runSessionCleanups(): void {
    for (const cleanup of cleanups) {
        try {
            cleanup();
        } catch {
            // Cleanup is best-effort; logout must always finish.
        }
    }
}
