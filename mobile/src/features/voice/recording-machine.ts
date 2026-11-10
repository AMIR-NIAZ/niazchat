import { formatDuration } from '../attachments/duration';
import {
    MAX_VOICE_DURATION_SECONDS,
    MIN_VOICE_DURATION_SECONDS,
    VOICE_WAVEFORM_BARS,
} from '../attachments/constants';

/**
 * Pure recording helpers: metering → level, peaks → 64 bars, duration limits.
 * No native imports, so the state rules can be unit tested in Node.
 */

/** dBFS (-60..0 is useful) → 0..1. Missing/NaN metering is silence. */
export function meteringLevel(db: number | null | undefined): number {
    if (typeof db !== 'number' || !Number.isFinite(db)) {
        return 0;
    }
    return Math.max(0, Math.min(1, (db + 60) / 60));
}

/** Resamples any number of collected peaks to exactly `bars` integers 0..100. */
export function normalizePeaks(
    peaks: readonly number[],
    bars: number = VOICE_WAVEFORM_BARS,
): number[] {
    if (bars <= 0) {
        return [];
    }
    const out: number[] = [];
    for (let index = 0; index < bars; index += 1) {
        const source =
            peaks[
                Math.min(
                    peaks.length - 1,
                    Math.floor((index * peaks.length) / bars),
                )
            ] ?? 0;
        out.push(Math.round(Math.max(0, Math.min(1, source)) * 100));
    }
    return out;
}

/** Clips under one second are discarded (with a short hint). */
export function shouldDiscardRecording(
    seconds: number,
    minimum: number = MIN_VOICE_DURATION_SECONDS,
): boolean {
    return !Number.isFinite(seconds) || seconds < minimum;
}

/** True once the 10-minute cap is reached and the clip must become a draft. */
export function reachedRecordingLimit(
    durationMs: number,
    maximumSeconds: number = MAX_VOICE_DURATION_SECONDS,
): boolean {
    return Number.isFinite(durationMs) && durationMs >= maximumSeconds * 1000;
}

/** Recording bar elapsed label (m:ss). */
export function recordingTimeLabel(durationMs: number): string {
    return formatDuration(Number.isFinite(durationMs) ? durationMs / 1000 : 0);
}
