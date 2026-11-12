/**
 * Geometry for the Telegram-style morphing profile avatar.
 *
 * Everything here is a pure function of the scroll offset, so reversing the
 * scroll halfway through simply replays the same geometry backwards: there is
 * no state to unwind, and therefore no jump and no flicker. Kept free of React
 * Native imports so it can be unit-tested (see `morphing-avatar-model.spec.ts`).
 */

/** Small "hanging" size the avatar settles into once it is pinned. */
export const MORPH_DEFAULT_COLLAPSED_WIDTH = 44;
export const MORPH_DEFAULT_COLLAPSED_HEIGHT = 56;
/** Top-corner radius of the collapsed droplet: small, so it reads as attached. */
export const MORPH_DEFAULT_NECK_RADIUS = 10;

export interface MorphConfig {
    /** Expanded (circular) edge length in dp. */
    expandedSize: number;
    /** Offset of the avatar inside the scroll content; scrolling past it pins. */
    topOffset: number;
    collapsedWidth?: number;
    collapsedHeight?: number;
    neckRadius?: number;
}

export interface MorphGeometry {
    /** Eased 0..1 morph progress (0 = circle, 1 = droplet). */
    progress: number;
    width: number;
    height: number;
    /** Downward offset that pins the avatar once it reaches the top edge. */
    translateY: number;
    borderTopLeftRadius: number;
    borderTopRightRadius: number;
    borderBottomLeftRadius: number;
    borderBottomRightRadius: number;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function lerp(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
}

/**
 * Scroll distance the morph is spread over. Proportional to the avatar so a
 * 256 dp group photo and a 128 dp user photo feel the same, floored so a small
 * avatar still animates over a visible distance.
 */
export function morphDistance(expandedSize: number): number {
    return Math.max(48, Math.round(expandedSize * 0.65));
}

/** Breathing room past the end of the morph, so it finishes before the limit. */
export const MORPH_TAIL_MARGIN = 16;

/**
 * Scroll content to add below a profile so the whole morph is reachable.
 *
 * The avatar needs `topOffset + distance` of scrolling to travel from a circle
 * to the pinned droplet. A profile whose content is shorter than the viewport
 * has NO scroll range at all (the list simply cannot move), which makes the
 * animation impossible to trigger — so the content always keeps that much
 * scrollable room. Nothing is hidden or cropped: the extra space sits below the
 * last section and is consumed by the morph itself.
 */
export function morphScrollTail(
    expandedSize: number,
    topOffset: number,
    minimum: number = 0,
): number {
    const travel = Math.max(0, topOffset) + morphDistance(expandedSize);
    return Math.max(minimum, Math.ceil(travel + MORPH_TAIL_MARGIN));
}

/** Smoothstep: zero slope at both ends, so neither end of the morph snaps. */
export function morphProgress(
    scrollY: number,
    topOffset: number,
    distance: number,
): number {
    if (distance <= 0) {
        return scrollY >= topOffset ? 1 : 0;
    }
    const raw = clamp((scrollY - topOffset) / distance, 0, 1);
    return raw * raw * (3 - 2 * raw);
}

/**
 * Full geometry for one scroll offset.
 *
 * Past `topOffset` the translation grows exactly as fast as the content moves
 * up, which cancels the scroll and pins the box against the top edge. Below it
 * the avatar keeps its normal place in the content (translation 0), so the two
 * halves meet at the same value and the hand-off cannot jump.
 */
export function morphGeometry(
    scrollY: number,
    config: MorphConfig,
): MorphGeometry {
    const collapsedWidth =
        config.collapsedWidth ?? MORPH_DEFAULT_COLLAPSED_WIDTH;
    const collapsedHeight =
        config.collapsedHeight ?? MORPH_DEFAULT_COLLAPSED_HEIGHT;
    const neckRadius = config.neckRadius ?? MORPH_DEFAULT_NECK_RADIUS;
    const expandedRadius = config.expandedSize / 2;

    const offset = Number.isFinite(scrollY) ? scrollY : 0;
    const progress = morphProgress(
        offset,
        config.topOffset,
        morphDistance(config.expandedSize),
    );
    // The width leads the height: the silhouette narrows before it gets short,
    // which is what turns a shrinking disc into a hanging droplet.
    const narrow = Math.pow(progress, 0.85);
    const bottomRadius = lerp(expandedRadius, collapsedWidth / 2, narrow);

    return {
        progress,
        width: lerp(config.expandedSize, collapsedWidth, narrow),
        height: lerp(config.expandedSize, collapsedHeight, progress),
        translateY: Math.max(0, offset - config.topOffset),
        borderTopLeftRadius: lerp(expandedRadius, neckRadius, narrow),
        borderTopRightRadius: lerp(expandedRadius, neckRadius, narrow),
        borderBottomLeftRadius: bottomRadius,
        borderBottomRightRadius: bottomRadius,
    };
}
