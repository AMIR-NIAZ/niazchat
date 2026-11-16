/**
 * Mask stops for the edge fade: an alpha ramp that is transparent at each outer
 * edge and opaque across the middle.
 *
 * Pure and framework-free so the geometry can be unit-tested — this math is
 * what decides whether content stays visible.
 */

/** Alpha ramp inside one fade band, as a fraction of the band height. */
const BAND_RAMP = [
    { position: 0, alpha: 0 },
    { position: 0.35, alpha: 0.15 },
    { position: 0.7, alpha: 0.82 },
    { position: 1, alpha: 1 },
] as const;

const EPSILON = 1e-4;

/**
 * Hard cap on each fade band, as a fraction of the measured height.
 *
 * A fade is decorative: it must never be able to hide the content. The two
 * bands are unrelated to the height they are drawn over (they follow the
 * floating header/composer, the reply preview and the mini player), so when the
 * keyboard shortens the view they used to add up to more than the whole view —
 * everything below the ramps became transparent, i.e. every message vanished.
 * Capping each band at 35 % of the height keeps at least 30 % of it fully
 * opaque no matter what the caller passes.
 */
export const MAX_FADE_RATIO = 0.35;

/** Visible-through mask used until the container has been measured. */
export const OPAQUE_STOPS = {
    colors: ['rgba(0,0,0,1)', 'rgba(0,0,0,1)'],
    locations: [0, 1],
} as const;

interface MaskStop {
    location: number;
    alpha: number;
}

/** Appends a stop, keeping the most opaque alpha for a repeated location. */
function pushStop(stops: MaskStop[], location: number, alpha: number): void {
    const clamped = Math.min(Math.max(location, 0), 1);
    const last = stops[stops.length - 1];
    if (last !== undefined && Math.abs(last.location - clamped) < EPSILON) {
        last.alpha = Math.max(last.alpha, alpha);
        return;
    }
    if (last !== undefined && clamped < last.location) {
        return;
    }
    stops.push({ location: clamped, alpha });
}

export function buildMaskStops(
    topFade: number,
    bottomFade: number,
    height: number,
): { colors: string[]; locations: number[] } {
    if (height <= 0) {
        // Nothing measured: a mask would hide the content entirely.
        return {
            colors: [...OPAQUE_STOPS.colors],
            locations: [...OPAQUE_STOPS.locations],
        };
    }
    // Clamp to the REAL height, not just proportionally: with the keyboard open
    // `topFade + bottomFade` can exceed the height, and a proportional scale
    // would leave a zero-width opaque core (invisible content).
    const maxBand = height * MAX_FADE_RATIO;
    const top = Math.min(Math.max(topFade, 0), maxBand);
    const bottom = Math.min(Math.max(bottomFade, 0), maxBand);

    // Band boundaries as fractions of the container height. With the clamps
    // above, `topEnd <= 0.35 < 0.65 <= bottomStart`: the bands never overlap and
    // the opaque core is always at least 30 % of the height.
    const topEnd = Math.min(top / height, 1 - MAX_FADE_RATIO);
    const bottomStart = Math.max(1 - bottom / height, MAX_FADE_RATIO);

    const stops: MaskStop[] = [];
    // Top band: transparent at the top edge, opaque at `topEnd`.
    for (const step of BAND_RAMP) {
        pushStop(stops, step.position * topEnd, step.alpha);
    }
    // Opaque core between the two bands.
    pushStop(stops, Math.max(topEnd, bottomStart), 1);
    // Bottom band: opaque from `bottomStart`, transparent at the bottom edge.
    for (const step of [...BAND_RAMP].reverse()) {
        pushStop(
            stops,
            bottomStart + (1 - bottomStart) * (1 - step.position),
            step.alpha,
        );
    }

    // A gradient needs at least two stops.
    if (stops.length < 2) {
        stops.push({ location: 1, alpha: 1 });
    }

    return {
        colors: stops.map(
            (stop): string =>
                `rgba(0,0,0,${Math.min(Math.max(stop.alpha, 0), 1)})`,
        ),
        locations: stops.map((stop): number => stop.location),
    };
}
