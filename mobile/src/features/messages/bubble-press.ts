/**
 * What a tap on a bubble means.
 *
 * The bubble is a Pressable around the bubble ONLY (never the row), and its
 * interactive children (media tiles, voice controls, file rows, quote, sender
 * name, reaction chips, links) must keep their own behaviour. A child press is
 * recorded through a passive responder-capture guard, so the bubble can tell
 * "the user pressed a control" from "the user pressed the bubble" without
 * relying on responder bubbling order alone.
 */

export type BubblePressOutcome = 'select' | 'retry' | 'menu' | 'none';

export interface BubblePressState {
    selectionMode: boolean;
    status: 'sent' | 'pending' | 'failed';
    hasAttachments: boolean;
    hasConfirmedId: boolean;
    /** True when an interactive child saw this same touch start. */
    childHandled: boolean;
}

/** A child press only shields the menu for this long (a press is ~<700 ms). */
export const CHILD_PRESS_GUARD_MS = 700;

export function resolveBubblePress(
    state: BubblePressState,
): BubblePressOutcome {
    if (state.selectionMode) {
        return 'select';
    }
    if (state.status === 'failed') {
        // Failed bubbles retry (or expose Retry/Remove inside the body).
        return state.hasAttachments ? 'none' : 'retry';
    }
    if (state.status !== 'sent') {
        // Pending bubbles expose Cancel and never open a menu.
        return 'none';
    }
    if (!state.hasConfirmedId) {
        return 'none';
    }
    if (state.childHandled) {
        return 'none';
    }
    return 'menu';
}

/** True while a recorded child press still owns the gesture. */
export function childPressBlocksMenu(
    lastChildPressAt: number,
    now: number,
): boolean {
    if (lastChildPressAt <= 0) {
        return false;
    }
    return now - lastChildPressAt < CHILD_PRESS_GUARD_MS;
}
