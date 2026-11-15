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
 * menu. Every copy — text, media, voice, file — keeps the measured size of the
 * pressed element EXACTLY: `previewHeight === anchor.height` is an invariant,
 * so the copy always shows the whole bubble (footer/time row included) and the
 * live row's box can be replaced by it without any visible jump.
 *
 * When the stack does not fit, it is moved as ONE block by the missing amount
 * (up when it would cross the bottom, down when it would cross the top), then
 * clamped to the usable area. No part is ever resized or re-stacked.
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
    /** The copy: the anchor's exact width and height, slid y. */
    previewX: number;
    previewY: number;
    previewWidth: number;
    previewHeight: number;
    reactions: PopupRect | null;
    menu: PopupRect | null;
    /** Centered card; when set, the anchor stack fields are zero. */
    center: PopupRect | null;
    /** The menu always sits below the copy. */
    placement: PopupPlacement;
    /** True when the centered card had to be cut. Anchor copies are never cut. */
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

    // EVERY copy keeps the measured anchor box exactly (its chrome — meta row,
    // caption, reply header — is part of the anchor). The copy is the live
    // bubble's box, so nothing is cropped and the footer never disappears.
    const previewX = input.anchor.x;
    const previewWidth = input.anchor.width;
    const previewHeight = input.anchor.height;
    const clipped = false;
    const placement: PopupPlacement = 'below';

    // The stack: [pill + GAP] copy [GAP + menu]. Its natural top puts the copy
    // exactly on the anchor. When the block does not fit, the WHOLE block is
    // shifted by the missing amount, then clamped to the usable area: the copy
    // is never resized and the gaps between the parts never change.
    const pillBlock = hasReactions ? REACTION_PILL_HEIGHT + POPUP_GAP : 0;
    const menuBlock = hasMenu ? POPUP_GAP + menuBoxHeight : 0;
    const stackHeight = pillBlock + previewHeight + menuBlock;

    let stackTop = input.anchor.y - pillBlock;
    if (stackTop + stackHeight > safeBottom) {
        stackTop -= stackTop + stackHeight - safeBottom;
    }
    stackTop = Math.max(safeTop, stackTop);

    const pillTop = stackTop;
    // Rounded only here: the host compensates this rounding with a translateY,
    // so the copy still rests on the bubble's exact y. x/width stay fractional
    // so the copy keeps the bubble's horizontal geometry (no re-wrapping).
    const previewY = Math.round(stackTop + pillBlock);
    const menuTop = previewY + previewHeight + POPUP_GAP;

    const reactionRect: PopupRect | null = hasReactions
        ? {
              x: Math.round(alignX(previewX, previewWidth, pillWidth)),
              y: Math.round(pillTop),
              width: pillWidth,
              height: REACTION_PILL_HEIGHT,
          }
        : null;

    const menuRect: PopupRect | null = hasMenu
        ? {
              x: Math.round(alignX(previewX, previewWidth, menuWidth)),
              y: Math.round(menuTop),
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
