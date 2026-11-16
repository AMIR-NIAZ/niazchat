/**
 * Pure clock math for the music player.
 *
 * The player never displays the position reported by status events: it keeps
 * a base position + a monotonic timestamp and derives the live position every
 * frame on the UI thread. These helpers are worklet-safe so the frame callback
 * and the JS sync points share exactly one formula.
 */

/** A re-base is needed when the player's sample drifted past this tolerance. */
export const MUSIC_SYNC_TOLERANCE_SECONDS = 0.6;

/** 0:00 / 0:07 / 12:42 — whole seconds, tabular-nums friendly. */
export function formatMusicClock(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Clamps a position into [0, duration] (duration 0/unknown = no upper bound). */
export function clampMusicPosition(value: number, duration: number): number {
    'worklet';
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (duration > 0 && value > duration) return duration;
    return value;
}

/** Live position (seconds) for the clock at `nowMs`. */
export function musicClockPosition(
    basePosition: number,
    baseTimestamp: number,
    isPlaying: boolean,
    rate: number,
    duration: number,
    nowMs: number,
): number {
    'worklet';
    if (!isPlaying) return clampMusicPosition(basePosition, duration);
    const elapsedMs = nowMs - baseTimestamp;
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
        return clampMusicPosition(basePosition, duration);
    }
    return clampMusicPosition(
        basePosition + (elapsedMs / 1000) * rate,
        duration,
    );
}

/**
 * True when a player sample is too far from the clock to be a measurement
 * artefact. Inside the tolerance the event is ignored so the display never
 * jitters or jumps backward on late/batched status updates.
 */
export function musicNeedsRebase(
    reportedPosition: number,
    clockPosition: number,
    tolerance: number = MUSIC_SYNC_TOLERANCE_SECONDS,
): boolean {
    if (!Number.isFinite(reportedPosition)) return false;
    return Math.abs(reportedPosition - clockPosition) > tolerance;
}
