import {
    MORPH_DEFAULT_COLLAPSED_HEIGHT,
    MORPH_DEFAULT_COLLAPSED_WIDTH,
    MORPH_DEFAULT_NECK_RADIUS,
    clamp,
    lerp,
    morphDistance,
    morphGeometry,
    morphProgress,
    morphScrollTail,
} from './morphing-avatar-model';

const TOP_OFFSET = 12;
const EXPANDED_SIZE = 128;
const CONFIG = { expandedSize: EXPANDED_SIZE, topOffset: TOP_OFFSET };
const DISTANCE = morphDistance(EXPANDED_SIZE);

describe('morphScrollTail', () => {
    it('covers the whole travel from the top to the collapsed state', () => {
        expect(morphScrollTail(128, 12)).toBe(111);
        expect(morphScrollTail(256, 24)).toBe(206);
    });

    it('always leaves enough room for the morph to finish', () => {
        for (const size of [40, 96, 128, 256]) {
            for (const topOffset of [0, 12, 24, 48]) {
                const tail = morphScrollTail(size, topOffset);
                expect(tail).toBeGreaterThanOrEqual(
                    topOffset + morphDistance(size),
                );
                const end = morphGeometry(topOffset + morphDistance(size), {
                    expandedSize: size,
                    topOffset,
                });
                expect(end.progress).toBe(1);
            }
        }
    });

    it('never shrinks an existing bottom padding', () => {
        expect(morphScrollTail(128, 12, 32)).toBe(111);
        expect(morphScrollTail(128, 0, 400)).toBe(400);
    });
});

describe('clamp / lerp', () => {
    it('clamps to the range', () => {
        expect(clamp(5, 0, 1)).toBe(1);
        expect(clamp(-5, 0, 1)).toBe(0);
        expect(clamp(0.25, 0, 1)).toBe(0.25);
    });

    it('interpolates linearly', () => {
        expect(lerp(10, 20, 0)).toBe(10);
        expect(lerp(10, 20, 1)).toBe(20);
        expect(lerp(10, 20, 0.5)).toBe(15);
    });
});

describe('morphDistance', () => {
    it('scales with the expanded avatar', () => {
        expect(morphDistance(256)).toBe(166);
        expect(morphDistance(128)).toBe(83);
    });

    it('never goes below a visible distance', () => {
        expect(morphDistance(1)).toBe(48);
    });
});

describe('morphProgress', () => {
    it('is zero until the avatar reaches the pinned line', () => {
        expect(morphProgress(-40, TOP_OFFSET, DISTANCE)).toBe(0);
        expect(morphProgress(0, TOP_OFFSET, DISTANCE)).toBe(0);
        expect(morphProgress(TOP_OFFSET, TOP_OFFSET, DISTANCE)).toBe(0);
    });

    it('reaches one exactly at the end of the morph distance', () => {
        expect(morphProgress(TOP_OFFSET + DISTANCE, TOP_OFFSET, DISTANCE)).toBe(1);
    });

    it('clamps past the end (max scroll offset / overscroll)', () => {
        expect(
            morphProgress(TOP_OFFSET + DISTANCE * 10, TOP_OFFSET, DISTANCE),
        ).toBe(1);
    });

    it('is monotonic and half-way at the middle', () => {
        const middle = morphProgress(
            TOP_OFFSET + DISTANCE / 2,
            TOP_OFFSET,
            DISTANCE,
        );
        expect(middle).toBeCloseTo(0.5, 6);
        let previous = 0;
        for (let i = 0; i <= 100; i += 1) {
            const value = morphProgress(
                TOP_OFFSET + (DISTANCE * i) / 100,
                TOP_OFFSET,
                DISTANCE,
            );
            expect(value).toBeGreaterThanOrEqual(previous);
            previous = value;
        }
    });

    it('handles a degenerate distance without dividing by zero', () => {
        expect(morphProgress(TOP_OFFSET - 1, TOP_OFFSET, 0)).toBe(0);
        expect(morphProgress(TOP_OFFSET, TOP_OFFSET, 0)).toBe(1);
    });
});

describe('morphGeometry', () => {
    it('is a plain circle at the top of the scroll', () => {
        const geometry = morphGeometry(0, CONFIG);
        expect(geometry.progress).toBe(0);
        expect(geometry.width).toBe(EXPANDED_SIZE);
        expect(geometry.height).toBe(EXPANDED_SIZE);
        expect(geometry.borderTopLeftRadius).toBe(EXPANDED_SIZE / 2);
        expect(geometry.borderTopRightRadius).toBe(EXPANDED_SIZE / 2);
        expect(geometry.borderBottomLeftRadius).toBe(EXPANDED_SIZE / 2);
        expect(geometry.borderBottomRightRadius).toBe(EXPANDED_SIZE / 2);
        expect(geometry.translateY).toBe(0);
    });

    it('is a hanging droplet at the end of the morph', () => {
        const geometry = morphGeometry(TOP_OFFSET + DISTANCE, CONFIG);
        expect(geometry.progress).toBe(1);
        expect(geometry.width).toBe(MORPH_DEFAULT_COLLAPSED_WIDTH);
        expect(geometry.height).toBe(MORPH_DEFAULT_COLLAPSED_HEIGHT);
        expect(geometry.borderTopLeftRadius).toBe(MORPH_DEFAULT_NECK_RADIUS);
        expect(geometry.borderTopRightRadius).toBe(MORPH_DEFAULT_NECK_RADIUS);
        expect(geometry.borderBottomLeftRadius).toBe(
            MORPH_DEFAULT_COLLAPSED_WIDTH / 2,
        );
        expect(geometry.borderBottomRightRadius).toBe(
            MORPH_DEFAULT_COLLAPSED_WIDTH / 2,
        );
        expect(geometry.translateY).toBe(DISTANCE);
    });

    it('stays vertically stretched once it starts morphing', () => {
        expect(MORPH_DEFAULT_COLLAPSED_HEIGHT).toBeGreaterThan(
            MORPH_DEFAULT_COLLAPSED_WIDTH,
        );
        const mid = morphGeometry(TOP_OFFSET + DISTANCE * 0.75, CONFIG);
        expect(mid.height).toBeGreaterThan(mid.width);
    });

    it('never widens or grows above the expanded size', () => {
        let previousWidth = EXPANDED_SIZE;
        let previousHeight = EXPANDED_SIZE;
        for (let i = 0; i <= 200; i += 1) {
            const geometry = morphGeometry(
                TOP_OFFSET + (DISTANCE * i) / 200,
                CONFIG,
            );
            expect(geometry.width).toBeLessThanOrEqual(previousWidth + 1e-9);
            expect(geometry.height).toBeLessThanOrEqual(previousHeight + 1e-9);
            expect(geometry.width).toBeLessThanOrEqual(EXPANDED_SIZE);
            previousWidth = geometry.width;
            previousHeight = geometry.height;
        }
    });

    it('pins the painted top edge without a jump', () => {
        // Viewport position of the painted box, per scroll step.
        let previousTop: number | null = null;
        for (let offset = -60; offset <= TOP_OFFSET + DISTANCE + 60; offset += 1) {
            const geometry = morphGeometry(offset, CONFIG);
            const paintedTop = TOP_OFFSET - offset + geometry.translateY;
            // Never above the pinned line, never moving down faster than scroll.
            expect(paintedTop).toBeGreaterThanOrEqual(0);
            if (previousTop !== null) {
                expect(previousTop - paintedTop).toBeGreaterThanOrEqual(0);
                expect(previousTop - paintedTop).toBeLessThanOrEqual(1);
            }
            previousTop = paintedTop;
        }
    });

    it('produces the same geometry in both scroll directions', () => {
        const offsets = [0, TOP_OFFSET, TOP_OFFSET + 10, TOP_OFFSET + DISTANCE];
        const down = offsets.map((offset) => morphGeometry(offset, CONFIG));
        const up = [...offsets]
            .reverse()
            .map((offset) => morphGeometry(offset, CONFIG))
            .reverse();
        expect(up).toEqual(down);
    });

    it('honours a wider group avatar with the same shape rules', () => {
        const group = { expandedSize: 256, topOffset: 24 };
        const distance = morphDistance(group.expandedSize);
        const start = morphGeometry(0, group);
        expect(start.width).toBe(256);
        expect(start.height).toBe(256);
        const end = morphGeometry(group.topOffset + distance, group);
        expect(end.width).toBe(MORPH_DEFAULT_COLLAPSED_WIDTH);
        expect(end.height).toBe(MORPH_DEFAULT_COLLAPSED_HEIGHT);
        expect(end.borderTopLeftRadius).toBe(MORPH_DEFAULT_NECK_RADIUS);
    });

    it('ignores a non-finite scroll offset', () => {
        const geometry = morphGeometry(Number.NaN, CONFIG);
        expect(geometry.width).toBe(EXPANDED_SIZE);
        expect(geometry.translateY).toBe(0);
    });
});
