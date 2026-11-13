/**
 * Pure geometry for the floating context popups — no measurement, no state.
 *
 * Everything works in WINDOW coordinates (`measureInWindow`). Because every
 * piece of chrome has a fixed size (44 px menu rows, a 52 px reaction pill,
 * fixed paddings), the whole stack can be laid out SYNCHRONOUSLY before the
 * first frame is drawn. That is what removed the `onLayout` wait: the popup is
 * never shown with an empty or half-sized container.
 *
 * The stack is: reaction pill, gap, copy of the pressed element, gap, action
 * menu. When the menu does not fit below the source, the sandwich flips: the
 * menu sits above the copy and the pill below it (`placement`).
 */

export interface PopupRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PopupSize {
    width: number;
    height: number;
}

export interface PopupInsets {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export type PopupAlign = 'start' | 'end';
export type PopupPlacement = 'below';

/** Space between the copy and each popup. */
export const POPUP_GAP = 8;
/** Minimum distance kept from every window / safe-area edge. */
export const POPUP_SCREEN_MARGIN = 12;
/** The copy is clipped to this share of the window height. */
export const POPUP_MAX_PREVIEW_RATIO = 0.70;
/** Never shrink the copy below this, even in a tiny window. */
export const POPUP_MIN_PREVIEW_HEIGHT = 48;
/** Centered cards (reactor list) never exceed this share of the window. */
export const POPUP_MAX_CENTERED_RATIO = 0.6;

/** Action menu chrome (must match `menu-card.tsx`). */
export const MENU_WIDTH = 236;
export const MENU_ROW_HEIGHT = 44;
export const MENU_PADDING = 8;

/** Reaction pill chrome (must match `reaction-pill.tsx`). */
export const REACTION_PILL_HEIGHT = 52;
export const REACTION_PILL_TARGET = 40;
export const REACTION_PILL_PADDING = 6;
export const REACTION_PILL_MAX_SLOTS = 6;

/** Card height for `rows` action rows. */
export function menuHeight(rows: number): number {
    return rows > 0 ? rows * MENU_ROW_HEIGHT + MENU_PADDING : 0;
}

/** Pill width for `count` emoji slots (extra emojis are not laid out). */
export function reactionPillWidth(count: number): number {
    const slots = Math.min(Math.max(count, 1), REACTION_PILL_MAX_SLOTS);
    return slots * REACTION_PILL_TARGET + REACTION_PILL_PADDING * 2;
}

export interface PopupLayoutInput {
    /** Source rect in window coordinates (measured at press time). */
    anchor: PopupRect;
    window: PopupSize;
    insets: PopupInsets;
    keyboardHeight: number;
    /** Number of action rows (0 = no menu). */
    itemCount: number;
    /** Number of reaction emoji (0 = no pill). */
    reactionCount: number;
    align: PopupAlign;
    /** Centered card instead of the anchor stack. */
    centerSize?: PopupSize | null;
}

export interface PopupLayout {
    /** The copy: the anchor's x/width, clamped (and clipped) y/height. */
    previewX: number;
    previewY: number;
    previewWidth: number;
    previewHeight: number;
    reactions: PopupRect | null;
    menu: PopupRect | null;
    /** Centered card; when set, the anchor stack fields are zero. */
    center: PopupRect | null;
    /** Whether the action menu ended up below or above the copy. */
    placement: PopupPlacement;
    /** True when the copy had to be cut to fit the window. */
    clipped: boolean;
}

const EMPTY: PopupLayout = {
    previewX: 0,
    previewY: 0,
    previewWidth: 0,
    previewHeight: 0,
    reactions: null,
    menu: null,
    center: null,
    placement: 'below',
    clipped: false,
};

export function computePopupLayout(input: PopupLayoutInput): PopupLayout {
    const windowWidth = Math.max(0, Math.round(input.window.width));
    const windowHeight = Math.max(0, Math.round(input.window.height));
    if (windowWidth === 0 || windowHeight === 0) {
        return EMPTY;
    }

    const keyboardHeight = Math.max(0, input.keyboardHeight);
    const safeLeft = input.insets.left + POPUP_SCREEN_MARGIN;
    const safeRight = windowWidth - input.insets.right - POPUP_SCREEN_MARGIN;
    const safeTop = input.insets.top + POPUP_SCREEN_MARGIN;
    const safeBottom =
        windowHeight -
        Math.max(input.insets.bottom, keyboardHeight) -
        POPUP_SCREEN_MARGIN;
    const availableWidth = Math.max(0, safeRight - safeLeft);
    const availableHeight = Math.max(0, safeBottom - safeTop);

    if (input.centerSize !== undefined && input.centerSize !== null) {
        const width = Math.min(input.centerSize.width, availableWidth);
        const height = Math.min(
            input.centerSize.height,
            Math.round(windowHeight * POPUP_MAX_CENTERED_RATIO),
            availableHeight,
        );
        return {
            ...EMPTY,
            center: {
                x: Math.round((windowWidth - width) / 2),
                y: Math.round(
                    safeTop + Math.max(0, (availableHeight - height) / 2),
                ),
                width,
                height,
            },
            clipped: height < input.centerSize.height,
        };
    }

    const alignX = (
        previewX: number,
        previewWidth: number,
        width: number,
    ): number => {
        const desired =
            input.align === 'end' ? previewX + previewWidth - width : previewX;
        return Math.min(
            Math.max(desired, safeLeft),
            Math.max(safeLeft, safeRight - width),
        );
    };

    const rows = Math.max(0, Math.round(input.itemCount));
    const reactions = Math.max(0, Math.round(input.reactionCount));
    const menuWidth = Math.min(MENU_WIDTH, availableWidth);
    const menuBoxHeight = menuHeight(rows);
    const hasMenu = menuBoxHeight > 0;
    const hasReactions = reactions > 0;
    const pillWidth = hasReactions
        ? Math.min(reactionPillWidth(reactions), availableWidth)
        : 0;

    const pillBlock = hasReactions ? REACTION_PILL_HEIGHT + POPUP_GAP : 0;
    const menuBlock = hasMenu ? menuBoxHeight + POPUP_GAP : 0;

    const previewLimit = Math.max(
        POPUP_MIN_PREVIEW_HEIGHT,
        Math.floor(windowHeight * POPUP_MAX_PREVIEW_RATIO),
    );
    const room = Math.max(
        POPUP_MIN_PREVIEW_HEIGHT,
        availableHeight - pillBlock - menuBlock,
    );
    const previewHeight = Math.max(
        1,
        Math.min(input.anchor.height, previewLimit, room),
    );
    const clipped = previewHeight < input.anchor.height;

    // Prefer the menu below the copy; flip the whole sandwich when that would
    // push it off-screen but the mirror image fits.
    const fitsBelow = input.anchor.y + previewHeight + menuBlock <= safeBottom;
    const canFlip =
        hasMenu &&
        input.anchor.y - POPUP_GAP - menuBoxHeight >= safeTop &&
        input.anchor.y + previewHeight + pillBlock <= safeBottom;
    const placement: PopupPlacement = !fitsBelow && canFlip ? 'below' : 'below';

    const aboveBlock = placement === 'below' ? pillBlock : menuBlock;
    const belowBlock = placement === 'below' ? menuBlock : pillBlock;
    const minY = safeTop + aboveBlock;
    const maxY = Math.max(minY, safeBottom - belowBlock - previewHeight);
    // Rounded only here: the host compensates this rounding with a translateY,
    // so the copy still rests on the bubble's exact y. x/width stay fractional
    // so the copy keeps the bubble's horizontal geometry (no re-wrapping).
    const previewY = Math.round(Math.min(Math.max(input.anchor.y, minY), maxY));
    const previewX = input.anchor.x;
    const previewWidth = Math.max(1, input.anchor.width);

    const reactionRect: PopupRect | null = hasReactions
        ? {
              x: Math.round(alignX(previewX, previewWidth, pillWidth)),
              y:
                  placement === 'below'
                      ? previewY - POPUP_GAP - REACTION_PILL_HEIGHT
                      : previewY + previewHeight + POPUP_GAP,
              width: pillWidth,
              height: REACTION_PILL_HEIGHT,
          }
        : null;

    const menuRect: PopupRect | null = hasMenu
        ? {
              x: Math.round(alignX(previewX, previewWidth, menuWidth)),
              y:
                  placement === 'below'
                      ? previewY + previewHeight + POPUP_GAP
                      : previewY - POPUP_GAP - menuBoxHeight,
              width: menuWidth,
              height: menuBoxHeight,
          }
        : null;

    return {
        previewX,
        previewY,
        previewWidth,
        previewHeight,
        reactions: reactionRect,
        menu: menuRect,
        center: null,
        placement,
        clipped,
    };
}
