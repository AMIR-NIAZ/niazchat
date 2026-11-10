import { buildWaveform } from './media-processor.service';

/**
 * Pure waveform reduction used by the voice upload path. No ffmpeg needed:
 * the PCM samples are constructed directly.
 */
describe('buildWaveform', () => {
    const samples = (value: (index: number) => number, length = 8_000) => {
        const out = new Int16Array(length);
        for (let index = 0; index < length; index += 1) {
            out[index] = value(index);
        }
        return out;
    };

    it('returns exactly 64 integers in 0..100', () => {
        const waveform = buildWaveform(samples(() => 12_000), 64);
        expect(waveform).not.toBeNull();
        expect(waveform).toHaveLength(64);
        for (const bar of waveform ?? []) {
            expect(Number.isInteger(bar)).toBe(true);
            expect(bar).toBeGreaterThanOrEqual(0);
            expect(bar).toBeLessThanOrEqual(100);
        }
    });

    it('keeps silence at zero', () => {
        const waveform = buildWaveform(samples(() => 0), 64);
        expect(waveform).toEqual(new Array(64).fill(0));
    });

    it('gives a loud tone high bars', () => {
        const waveform = buildWaveform(
            samples((index) => (index % 2 === 0 ? 20_000 : -20_000)),
            64,
        );
        expect(Math.max(...(waveform ?? [0]))).toBeGreaterThan(50);
    });

    it('shows shape when a quiet clip has a quiet peak', () => {
        // Half the clip is near-silent, half is quiet: sqrt compression must
        // still produce visible (but bounded) bars on the loud half.
        const waveform = buildWaveform(
            samples((index) => (index < 4_000 ? 0 : 900), 8_000),
            64,
        );
        expect(waveform?.slice(0, 24)).toEqual(new Array(24).fill(0));
        expect(Math.max(...(waveform ?? [0]))).toBe(100);
    });

    it('returns null for empty input', () => {
        expect(buildWaveform(new Int16Array(0), 64)).toBeNull();
    });
});
