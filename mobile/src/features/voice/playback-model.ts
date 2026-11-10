/** Pure playback helpers (no native imports): speed cycle, progress, labels. */

export const VOICE_SPEEDS = [1, 1.5, 2] as const;
export type VoiceSpeed = (typeof VOICE_SPEEDS)[number];

export function nextSpeed(rate: number): VoiceSpeed {
    const index = VOICE_SPEEDS.indexOf(rate as VoiceSpeed);
    return VOICE_SPEEDS[(index + 1) % VOICE_SPEEDS.length] ?? 1;
}

export function speedLabel(rate: number): string {
    return `${rate}x`;
}

/** 0..1, safe for zero/invalid durations and out-of-range positions. */
export function progressRatio(position: number, duration: number): number {
    if (!Number.isFinite(position) || !Number.isFinite(duration)) {
        return 0;
    }
    if (duration <= 0) {
        return 0;
    }
    return Math.max(0, Math.min(1, position / duration));
}

/** Seconds left, never negative. */
export function remainingSeconds(position: number, duration: number): number {
    if (!Number.isFinite(position) || !Number.isFinite(duration)) {
        return 0;
    }
    return Math.max(0, duration - position);
}
