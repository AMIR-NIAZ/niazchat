import { buildMaskStops, MAX_FADE_RATIO } from './mask-stops';

function alphaAt(
    stops: { colors: string[]; locations: number[] },
    location: number,
): number {
    // Piecewise-linear sampling of the gradient at `location`.
    const { colors, locations } = stops;
    for (let index = 0; index < locations.length; index += 1) {
        const next = locations[index + 1];
        const current = locations[index];
        if (current === undefined) break;
        if (next === undefined) break;
        if (location >= current && location <= next) {
            const span = next - current;
            const t = span === 0 ? 0 : (location - current) / span;
            const from = Number(
                colors[index]?.replace(/.*,(?<alpha>[0-9.]+)\)$/u, '$1') ?? '0',
            );
            const to = Number(
                colors[index + 1]?.replace(/.*,(?<alpha>[0-9.]+)\)$/u, '$1') ??
                    '0',
            );
            return from + (to - from) * t;
        }
    }
    return 0;
}

it('never masks the content out, whatever the fade heights are', () => {
    // The broken case: a 500 px frame (keyboard open) with the fades derived
    // from the double-counted keyboard inset (196 px top + 512 px bottom).
    const cases: Array<[number, number, number]> = [
        [196, 512, 500],
        [196, 180, 500],
        [196, 180, 460],
        [196, 180, 800],
        [0, 0, 500],
        [0, 400, 300],
    ];
    for (const [topFade, bottomFade, height] of cases) {
        const stops = buildMaskStops(topFade, bottomFade, height);
        // Middle of the view is fully opaque: at least 30 % of the height is
        // never faded, because each band is capped at 35 %.
        expect(alphaAt(stops, 0.5)).toBe(1);
        // Locations strictly increasing and inside [0, 1].
        for (let index = 1; index < stops.locations.length; index += 1) {
            expect(stops.locations[index]!).toBeGreaterThan(
                stops.locations[index - 1]!,
            );
            expect(stops.locations[index]!).toBeLessThanOrEqual(1);
        }
        expect(stops.locations[0]).toBe(0);
        // Only a band that actually exists is transparent at its outer edge.
        expect(stops.colors[0]).toBe(
            topFade > 0 ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)',
        );
    }
});

it('an unmeasured container renders fully opaque', () => {
    const stops = buildMaskStops(196, 180, 0);
    expect(stops.colors).toEqual(['rgba(0,0,0,1)', 'rgba(0,0,0,1)']);
    expect(stops.locations).toEqual([0, 1]);
});

it('bands are capped at 35 % of the measured height', () => {
    const height = 400;
    const stops = buildMaskStops(1000, 1000, height);
    const opaqueFrom = stops.locations.find(
        (location, index) => stops.colors[index] === 'rgba(0,0,0,1)',
    );
    expect(opaqueFrom).toBeLessThanOrEqual(height * MAX_FADE_RATIO);
    expect(stops.locations.at(-2)).toBeLessThanOrEqual(1);
});
