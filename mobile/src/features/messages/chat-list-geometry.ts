/**
 * Geometry of the full-screen chat list.
 *
 * The list spans the whole window (behind the floating header and composer), so
 * its content has to reserve the space those two overlays occupy. All values
 * are distances from the window's bottom edge.
 *
 * The composer stack sits `baseMargin` above the window bottom and is lifted by
 * the keyboard; the list frame is shortened by the same keyboard amount (the
 * Android `keyboardInset` padding on the list layer, the iOS
 * `KeyboardAvoidingView` padding). The two cancel, so the overlap — and with it
 * the padding and the bottom fade — is independent of the keyboard. Adding the
 * keyboard height here as well is what used to double-count it: on Android with
 * the IME open the padding reached the full list height and the messages were
 * pushed out of view entirely.
 */

export interface ChatListGeometryInput {
    /** Measured header layer height (safe-area top + pill). */
    headerHeight: number;
    /** Measured composer content height (excludes the keyboard padding). */
    composerHeight: number;
    /** Measured notices block above the composer (0 when hidden). */
    noticesHeight: number;
    /** Distance from the window bottom to the composer stack's bottom edge. */
    bottomMargin: number;
    /** Extra strip the music mini-bar adds under the header. */
    musicBarStrip: number;
    /** Height added on top of the chrome for the edge fades. */
    fadeExtra: number;
    /** Gap between the list content and the chrome. */
    gap: number;
    /** Measured list viewport height (0 while unknown). */
    listHeight: number;
}

export interface ChatListGeometry {
    /** How far the composer stack overlaps the list frame (keyboard-free). */
    composerOverlap: number;
    /** Header + mini-bar strip: the VISUAL top edge of the inverted list. */
    headerStrip: number;
    /** Inverted list: paddingTop is the VISUAL bottom (composer side). */
    listPaddingTop: number;
    /** Inverted list: paddingBottom is the VISUAL top (header/bar side). */
    listPaddingBottom: number;
    topFade: number;
    bottomFade: number;
    indicatorTop: number;
    indicatorBottom: number;
}

export function chatListGeometry(
    input: ChatListGeometryInput,
): ChatListGeometry {
    const baseMargin = Math.max(0, input.bottomMargin);
    const composerOverlap =
        Math.max(0, input.composerHeight) +
        Math.max(0, input.noticesHeight) +
        baseMargin;
    const headerStrip =
        Math.max(0, input.headerHeight) + Math.max(0, input.musicBarStrip);
    const gap = Math.max(0, input.gap);
    const rawTop = composerOverlap + gap;
    const rawBottom = headerStrip + gap;
    // Almost all of the frame must stay content: the chrome is a floating
    // overlay, so it may never reserve more than half of the view. On a very
    // short frame (keyboard open, reply preview + notices showing) the exact
    // overlap would eat the whole list and the messages would be pushed out of
    // sight — the same symptom as the fade bug, from the padding side.
    const headroom = Math.max(0, input.listHeight) / 2;
    const scale =
        headroom > 0 && rawTop + rawBottom > headroom
            ? headroom / (rawTop + rawBottom)
            : 1;
    return {
        composerOverlap,
        headerStrip,
        listPaddingTop: Math.round(rawTop * scale),
        listPaddingBottom: Math.round(rawBottom * scale),
        topFade: Math.round(headerStrip + input.fadeExtra),
        bottomFade: Math.round(composerOverlap + input.fadeExtra),
        indicatorTop: Math.round(headerStrip),
        indicatorBottom: Math.round(composerOverlap),
    };
}
