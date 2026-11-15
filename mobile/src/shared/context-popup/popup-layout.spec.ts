import {
    MENU_PADDING,
    MENU_ROW_HEIGHT,
    POPUP_GAP,
    POPUP_MAX_CENTERED_RATIO,
    POPUP_SCREEN_MARGIN,
    REACTION_PILL_HEIGHT,
    computePopupLayout,
    menuHeight,
    reactionPillWidth,
} from './popup-layout';
import type { PopupLayoutInput, PopupRect } from './popup-layout';

const WINDOW = { width: 400, height: 800 };
const INSETS = { top: 24, bottom: 16, left: 0, right: 0 };

function input(overrides: Partial<PopupLayoutInput> = {}): PopupLayoutInput {
    return {
        anchor: { x: 20, y: 300, width: 260, height: 80 },
        window: WINDOW,
        insets: INSETS,
        keyboardHeight: 0,
        itemCount: 4,
        reactionCount: 6,
        align: 'start',
        ...overrides,
    };
}

/** The stack top the simple rule computes for a layout. */
function expectedStackTop(
    layout: ReturnType<typeof computePopupLayout>,
    anchor: PopupRect,
    keyboardHeight = 0,
    insets = INSETS,
): number {
    const safeTop = insets.top + POPUP_SCREEN_MARGIN;
    const safeBottom =
        WINDOW.height -
        Math.max(insets.bottom, keyboardHeight) -
        POPUP_SCREEN_MARGIN;
    const pillBlock =
        layout.reactions !== null ? REACTION_PILL_HEIGHT + POPUP_GAP : 0;
    const menuBlock = layout.menu !== null ? POPUP_GAP + layout.menu.height : 0;
    const stackHeight = pillBlock + layout.previewHeight + menuBlock;
    return Math.max(
        safeTop,
        Math.min(anchor.y - pillBlock, safeBottom - stackHeight),
    );
}

/**
 * Placement invariants every message type must satisfy: the copy is the
 * anchor's exact box, the parts keep exactly one GAP, and the whole stack is
 * only ever shifted as one block inside the usable area.
 */
function expectPlacement(
    layout: ReturnType<typeof computePopupLayout>,
    anchor: PopupRect,
    keyboardHeight = 0,
    insets = INSETS,
): void {
    const safeTop = insets.top + POPUP_SCREEN_MARGIN;
    const safeBottom =
        WINDOW.height -
        Math.max(insets.bottom, keyboardHeight) -
        POPUP_SCREEN_MARGIN;
    const pillBlock =
        layout.reactions !== null ? REACTION_PILL_HEIGHT + POPUP_GAP : 0;
    const menuBlock = layout.menu !== null ? POPUP_GAP + layout.menu.height : 0;
    const stackHeight = pillBlock + layout.previewHeight + menuBlock;

    // The copy is the live bubble's exact box, never cropped or scaled.
    expect(layout.previewX).toBe(anchor.x);
    expect(layout.previewWidth).toBe(anchor.width);
    expect(layout.previewHeight).toBe(anchor.height);

    // The stack is shifted as one block: same previewY for every case.
    const stackTop = expectedStackTop(layout, anchor, keyboardHeight, insets);
    expect(layout.previewY).toBe(Math.round(stackTop + pillBlock));

    // The gaps never change.
    if (layout.reactions !== null) {
        expect(layout.reactions.y).toBe(
            layout.previewY - POPUP_GAP - REACTION_PILL_HEIGHT,
        );
    }
    if (layout.menu !== null) {
        expect(layout.menu.y).toBe(
            layout.previewY + layout.previewHeight + POPUP_GAP,
        );
    }

    // Clamped to the usable area: fully inside when it fits, top-aligned when
    // the block is taller than the area (the copy is never resized).
    if (stackHeight <= safeBottom - safeTop) {
        expect(stackTop).toBeGreaterThanOrEqual(safeTop);
        expect(stackTop + stackHeight).toBeLessThanOrEqual(safeBottom);
    } else {
        expect(stackTop).toBe(safeTop);
    }
}

describe('computePopupLayout', () => {
    it('rests the copy exactly on the anchor and stacks both popups', () => {
        const anchor = { x: 20, y: 300, width: 260, height: 80 };
        const layout = computePopupLayout(input({ anchor }));
        expect(layout.previewY).toBe(300);
        expect(layout.placement).toBe('below');
        expect(layout.reactions).toEqual({
            x: 20,
            y: 300 - POPUP_GAP - REACTION_PILL_HEIGHT,
            width: reactionPillWidth(6),
            height: REACTION_PILL_HEIGHT,
        });
        expect(layout.menu).toEqual({
            x: 20,
            y: 300 + 80 + POPUP_GAP,
            width: 236,
            height: menuHeight(4),
        });
        expectPlacement(layout, anchor);
    });

    it('uses fixed chrome sizes, so no measurement is needed', () => {
        expect(menuHeight(3)).toBe(3 * MENU_ROW_HEIGHT + MENU_PADDING);
        expect(menuHeight(0)).toBe(0);
        expect(reactionPillWidth(1)).toBe(40 + 12);
        // Extra emoji do not widen the pill past its slot cap.
        expect(reactionPillWidth(9)).toBe(reactionPillWidth(6));
    });

    it('aligns the popups to the end of the copy for my own messages', () => {
        const layout = computePopupLayout(input({ align: 'end' }));
        expect(layout.menu?.x).toBe(20 + 260 - 236);
        expect(layout.reactions?.x).toBe(20 + 260 - reactionPillWidth(6));
    });

    it('clamps the popup x inside the window', () => {
        const anchor = { x: 2, y: 300, width: 120, height: 60 };
        const layout = computePopupLayout(input({ anchor }));
        expect(layout.menu?.x).toBe(POPUP_SCREEN_MARGIN);
        expectPlacement(layout, anchor);
    });

    const CASES: [string, PopupRect, PopupLayoutInput['align']][] = [
        [
            'text, their bubble',
            { x: 16, y: 420, width: 212, height: 54 },
            'start',
        ],
        [
            'tall text, my bubble',
            { x: 140, y: 120, width: 244, height: 280 },
            'end',
        ],
        ['image', { x: 20, y: 260, width: 260, height: 180 }, 'start'],
        ['portrait video', { x: 60, y: 240, width: 260, height: 320 }, 'end'],
        ['near the top', { x: 16, y: 40, width: 212, height: 96 }, 'start'],
        ['near the bottom', { x: 16, y: 700, width: 212, height: 90 }, 'start'],
    ];

    for (const [name, anchor, align] of CASES) {
        it(`keeps the copy at its measured size: ${name}`, () => {
            const layout = computePopupLayout(input({ anchor, align }));
            expectPlacement(layout, anchor);
        });
    }

    it('keeps a very tall text copy at its measured height (footer included)', () => {
        // A ~3000-char message measures around 3000 px tall on a phone. The
        // copy is NEVER cropped: it is the live bubble's exact box.
        const anchor = { x: 16, y: 200, width: 212, height: 3000 };
        const layout = computePopupLayout(input({ anchor }));
        expect(layout.previewHeight).toBe(anchor.height);
        expect(layout.previewX).toBe(anchor.x);
        expect(layout.previewWidth).toBe(anchor.width);
        expect(layout.clipped).toBe(false);
        // Taller than the usable area: the block is clamped to the top.
        expect(layout.previewY).toBe(
            INSETS.top + POPUP_SCREEN_MARGIN + REACTION_PILL_HEIGHT + POPUP_GAP,
        );
        expectPlacement(layout, anchor);
    });

    it('never resizes a media copy, even when it is very tall', () => {
        const anchor = { x: 20, y: 200, width: 260, height: 3000 };
        const layout = computePopupLayout(input({ anchor }));
        expect(layout.previewHeight).toBe(3000);
        expect(layout.clipped).toBe(false);
        expectPlacement(layout, anchor);
    });

    it('does not shrink a tall copy to a share of the window', () => {
        const anchor = { x: 20, y: 200, width: 260, height: 700 };
        const layout = computePopupLayout(
            input({ anchor, itemCount: 0, reactionCount: 0 }),
        );
        expect(layout.previewHeight).toBe(700);
        expect(layout.clipped).toBe(false);
        expect(layout.menu).toBeNull();
        expect(layout.reactions).toBeNull();
        // Shifted up only enough to keep its bottom inside the usable area.
        expect(layout.previewY).toBe(
            WINDOW.height - INSETS.bottom - POPUP_SCREEN_MARGIN - 700,
        );
    });

    it('shifts the whole stack up for a low message (menu stays one GAP below)', () => {
        const anchor = { x: 20, y: 620, width: 260, height: 120 };
        const layout = computePopupLayout(input({ anchor }));
        expectPlacement(layout, anchor);
        expect(layout.previewY).toBeLessThan(anchor.y);
        expect(layout.menu?.y).toBe(
            layout.previewY + layout.previewHeight + POPUP_GAP,
        );
        expect(layout.reactions?.y).toBe(
            layout.previewY - POPUP_GAP - REACTION_PILL_HEIGHT,
        );
    });

    it('keeps the copy on-screen with a large top inset', () => {
        const anchor = { x: 20, y: 10, width: 200, height: 100 };
        const insets = { top: 120, bottom: 90, left: 0, right: 0 };
        const layout = computePopupLayout(input({ insets, anchor }));
        // The whole block is pushed DOWN to the usable top.
        expect(layout.reactions?.y).toBe(120 + POPUP_SCREEN_MARGIN);
        expectPlacement(layout, anchor, 0, insets);
    });

    it('accounts for the keyboard', () => {
        const anchor = { x: 20, y: 420, width: 260, height: 80 };
        const layout = computePopupLayout(
            input({ anchor, keyboardHeight: 300 }),
        );
        expectPlacement(layout, anchor, 300);
        // The whole block is shifted up to clear the keyboard.
        expect(layout.previewY).toBeLessThan(anchor.y);
        expect(layout.menu).not.toBeNull();
        const menuBottom = (layout.menu?.y ?? 0) + (layout.menu?.height ?? 0);
        expect(menuBottom).toBeLessThanOrEqual(
            800 - Math.max(INSETS.bottom, 300) - POPUP_SCREEN_MARGIN,
        );
    });

    it('lays out the last message right above the input bar (keyboard closed)', () => {
        const anchor = { x: 16, y: 640, width: 212, height: 56 };
        const layout = computePopupLayout(input({ anchor }));
        expectPlacement(layout, anchor);
        expect(layout.menu).not.toBeNull();
    });

    it('lays out the 2nd and 3rd message with the keyboard open and closed', () => {
        for (const anchor of [
            { x: 16, y: 640, width: 212, height: 56 },
            { x: 200, y: 576, width: 160, height: 64 },
        ]) {
            const closed = computePopupLayout(input({ anchor }));
            expectPlacement(closed, anchor);

            const open = computePopupLayout(
                input({ anchor, keyboardHeight: 320 }),
            );
            expectPlacement(open, anchor, 320);
        }
    });

    it('lays out a chat with only one or two messages', () => {
        for (const anchor of [
            { x: 16, y: 680, width: 120, height: 48 },
            { x: 200, y: 612, width: 160, height: 64 },
        ]) {
            const layout = computePopupLayout(input({ anchor }));
            expectPlacement(layout, anchor);
        }
    });

    it('shifts the whole stack down for a first message near the top', () => {
        const anchor = { x: 16, y: 40, width: 212, height: 64 };
        const layout = computePopupLayout(input({ anchor }));
        // The pill (and everything under it) starts at the usable top.
        expect(layout.reactions?.y).toBe(INSETS.top + POPUP_SCREEN_MARGIN);
        expect(layout.previewY).toBeGreaterThan(anchor.y);
        expectPlacement(layout, anchor);
    });

    it('keeps the stack together for a media copy that cannot fit', () => {
        const anchor = { x: 20, y: 120, width: 260, height: 900 };
        const layout = computePopupLayout(input({ anchor }));
        expect(layout.previewHeight).toBe(anchor.height);
        expect(layout.clipped).toBe(false);
        // Clamped to the usable top as one block.
        expect(layout.reactions?.y).toBe(INSETS.top + POPUP_SCREEN_MARGIN);
        expect(layout.menu?.y).toBe(
            layout.previewY + layout.previewHeight + POPUP_GAP,
        );
        expectPlacement(layout, anchor);
    });

    it('stacks normally when the whole stack fits', () => {
        const anchor = { x: 20, y: 300, width: 260, height: 80 };
        const layout = computePopupLayout(input({ anchor }));
        expect(layout.previewY).toBe(anchor.y);
        expect(layout.reactions?.y).toBe(
            anchor.y - POPUP_GAP - REACTION_PILL_HEIGHT,
        );
        expect(layout.menu?.y).toBe(anchor.y + anchor.height + POPUP_GAP);
        expectPlacement(layout, anchor);
    });

    it('shrinks the menu width when the window is narrower', () => {
        const layout = computePopupLayout(
            input({
                window: { width: 180, height: 800 },
                anchor: { x: 10, y: 300, width: 120, height: 60 },
            }),
        );
        expect(layout.menu?.width).toBe(180 - 2 * POPUP_SCREEN_MARGIN);
        expect(layout.menu?.x).toBe(POPUP_SCREEN_MARGIN);
    });

    it('returns an empty layout for a zero-sized window', () => {
        const layout = computePopupLayout(
            input({ window: { width: 0, height: 0 } }),
        );
        expect(layout.previewWidth).toBe(0);
        expect(layout.reactions).toBeNull();
        expect(layout.menu).toBeNull();
        expect(layout.center).toBeNull();
    });

    it('centers a card and caps its height at 60% of the window', () => {
        const layout = computePopupLayout(
            input({ centerSize: { width: 340, height: 700 } }),
        );
        expect(layout.menu).toBeNull();
        expect(layout.reactions).toBeNull();
        expect(layout.center?.width).toBe(340);
        expect(layout.center?.height).toBe(
            Math.floor(800 * POPUP_MAX_CENTERED_RATIO),
        );
        expect(layout.center?.x).toBe(30);
        expect(layout.clipped).toBe(true);
    });

    it('centers a smaller card vertically in the usable area', () => {
        const layout = computePopupLayout(
            input({ centerSize: { width: 340, height: 300 } }),
        );
        const safeTop = INSETS.top + POPUP_SCREEN_MARGIN;
        const safeBottom = 800 - INSETS.bottom - POPUP_SCREEN_MARGIN;
        const center = layout.center;
        expect(center?.height).toBe(300);
        const topGap = (center?.y ?? 0) - safeTop;
        const bottomGap = safeBottom - ((center?.y ?? 0) + 300);
        expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(1);
    });
});
