import {
    MUSIC_SYNC_TOLERANCE_SECONDS,
    clampMusicPosition,
    musicClockPosition,
    musicNeedsRebase,
} from './music-clock';

const FRAME_MS = 1000 / 60;

/** Runs the clock at 60 fps and records every whole-second label tick. */
function simulateTicks(
    seconds: number,
    rate: number,
    duration: number,
): number[] {
    const ticks: number[] = [];
    let previous = Math.floor(
        musicClockPosition(0, 0, true, rate, duration, 0),
    );
    const frames = Math.round((seconds * 1000) / FRAME_MS);
    for (let frame = 1; frame <= frames; frame += 1) {
        const position = musicClockPosition(
            0,
            0,
            true,
            rate,
            duration,
            frame * FRAME_MS,
        );
        const whole = Math.floor(position);
        if (whole !== previous) {
            ticks.push(whole);
            previous = whole;
        }
    }
    return ticks;
}

describe('music clock', () => {
    it('advances exactly one label second per second at 1x', () => {
        expect(simulateTicks(10, 1, 0)).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        ]);
    });

    it('does not depend on status-event frequency (clock-driven display)', () => {
        // Same clock, but "events" only land every 2 s and are ignored inside
        // the tolerance: the derived position still ticks one by one.
        const duration = 20;
        let base = 0;
        let timestamp = 0;
        const ticks: number[] = [];
        let previous = 0;
        const frames = (10 * 1000) / FRAME_MS;
        for (let frame = 1; frame <= frames; frame += 1) {
            const now = frame * FRAME_MS;
            if (frame % 120 === 0) {
                // A late, batched status sample: 0.5 s behind the clock.
                const reported = now / 1000 - 0.5;
                const current = musicClockPosition(
                    base,
                    timestamp,
                    true,
                    1,
                    duration,
                    now,
                );
                if (musicNeedsRebase(reported, current)) {
                    base = reported;
                    timestamp = now;
                }
            }
            const position = musicClockPosition(
                base,
                timestamp,
                true,
                1,
                duration,
                now,
            );
            const whole = Math.floor(position);
            if (whole !== previous) {
                ticks.push(whole);
                previous = whole;
            }
        }
        expect(ticks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('respects playback rate', () => {
        // 2x: four wall seconds = eight track seconds (one tick per 0.5 s).
        expect(simulateTicks(4, 2, 0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(simulateTicks(8, 0.75, 0)).toEqual([1, 2, 3, 4, 5, 6]);
        const atHalfSpeed = musicClockPosition(0, 0, true, 0.75, 0, 4000);
        expect(atHalfSpeed).toBeCloseTo(3, 5);
        const atDoubleSpeed = musicClockPosition(0, 0, true, 2, 0, 4000);
        expect(atDoubleSpeed).toBeCloseTo(8, 5);
    });

    it('freezes when paused and clamps at duration', () => {
        expect(musicClockPosition(42, 0, false, 1, 100, 90_000)).toBe(42);
        expect(musicClockPosition(0, 0, true, 1, 10, 12_000)).toBe(10);
        expect(clampMusicPosition(-3, 10)).toBe(0);
        expect(clampMusicPosition(3, 0)).toBe(3);
    });

    it('ignores corrections inside the 0.6 s tolerance', () => {
        expect(MUSIC_SYNC_TOLERANCE_SECONDS).toBe(0.6);
        expect(musicNeedsRebase(10.5, 10.1)).toBe(false);
        expect(musicNeedsRebase(10.1, 10.5)).toBe(false);
        expect(musicNeedsRebase(10.8, 10.1)).toBe(true);
        expect(musicNeedsRebase(Number.NaN, 10.1)).toBe(false);
    });

    it('re-bases a paused track only when the sample is far off', () => {
        expect(musicNeedsRebase(41.8, 42)).toBe(false);
        expect(musicNeedsRebase(40, 42)).toBe(true);
    });
});
