import {
    MENU_PADDING,
    MENU_ROW_HEIGHT,
    POPUP_GAP,
    POPUP_MAX_CENTERED_RATIO,
    POPUP_MAX_PREVIEW_RATIO,
    POPUP_SCREEN_MARGIN,
    REACTION_PILL_HEIGHT,
    computePopupLayout,
    menuHeight,
    reactionPillWidth,
} from './popup-layout';
import type { PopupLayoutInput } from './popup-layout';

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

describe('computePopupLayout', () => {
    it('rests the copy exactly on the anchor and stacks both popups', () => {
        const layout = computePopupLayout(input());
        expect(layout.previewX).toBe(20);
        expect(layout.previewY).toBe(300);
        expect(layout.previewWidth).toBe(260);
        expect(layout.previewHeight).toBe(80);
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
        const layout = computePopupLayout(
            input({
                anchor: { x: 2, y: 300, width: 120, height: 60 },
            }),
        );
        expect(layout.menu?.x).toBe(POPUP_SCREEN_MARGIN);
        expect(layout.previewX).toBe(2);
    });

    it('flips the sandwich when the menu cannot fit below the source', () => {
        const layout = computePopupLayout(
            input({ anchor: { x: 20, y: 640, width: 260, height: 80 } }),
        );
        expect(layout.placement).toBe('above');
        expect(layout.menu?.y).toBe(640 - POPUP_GAP - menuHeight(4));
        expect(layout.reactions?.y).toBe(640 + 80 + POPUP_GAP);
        expect(layout.previewY).toBe(640);
    });

    it('shifts the copy only as far as the safe area requires', () => {
        const layout = computePopupLayout(
            input({
                anchor: { x: 20, y: 40, width: 260, height: 80 },
                itemCount: 0,
            }),
        );
        expect(layout.previewY).toBe(
            INSETS.top + POPUP_SCREEN_MARGIN + 52 + POPUP_GAP,
        );
        expect(layout.menu).toBeNull();
    });

    it('clips a tall copy to 45% of the window', () => {
        const layout = computePopupLayout(
            input({
                anchor: { x: 20, y: 200, width: 260, height: 700 },
                itemCount: 0,
                reactionCount: 0,
            }),
        );
        expect(layout.clipped).toBe(true);
        expect(layout.previewHeight).toBe(
            Math.floor(800 * POPUP_MAX_PREVIEW_RATIO),
        );
        expect(layout.reactions).toBeNull();
        expect(layout.menu).toBeNull();
    });

    it('keeps the copy on-screen with a large top inset', () => {
        const layout = computePopupLayout(
            input({
                insets: { top: 120, bottom: 90, left: 0, right: 0 },
                anchor: { x: 20, y: 10, width: 200, height: 100 },
            }),
        );
        expect(layout.previewY).toBeGreaterThanOrEqual(
            120 + POPUP_SCREEN_MARGIN + REACTION_PILL_HEIGHT + POPUP_GAP,
        );
        const menuBottom = (layout.menu?.y ?? 0) + (layout.menu?.height ?? 0);
        expect(menuBottom).toBeLessThanOrEqual(800 - 90 - POPUP_SCREEN_MARGIN);
    });

    it('accounts for the keyboard', () => {
        const layout = computePopupLayout(
            input({
                keyboardHeight: 300,
                anchor: { x: 20, y: 420, width: 260, height: 80 },
            }),
        );
        const bottomEdge = (layout.menu?.y ?? 0) + (layout.menu?.height ?? 0);
        expect(bottomEdge).toBeLessThanOrEqual(800 - 300 - POPUP_SCREEN_MARGIN);
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
