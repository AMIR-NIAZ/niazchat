/**
 * Pure scroll decisions for the conversation list.
 *
 * The chat screen has several things that can move an inverted `FlatList`
 * (initial positioning, live messages, the keyboard re-anchor, jump-to-message,
 * the scroll-to-latest button). Keeping their guards here — instead of inline
 * booleans spread across effects — is what prevents two of them from issuing
 * competing commands during the first frames of a chat and making the list
 * visibly jump between positions.
 */

/** Corrections allowed for one `scrollToIndex` request whose row is unmeasured. */
export const MAX_SCROLL_INDEX_RETRIES = 3;

/**
 * An inverted list measures offsets from the newest row (visual bottom), so
 * `viewPosition` is reversed: 0 is the bottom edge, 1 is the visual top.
 * The first unread message must open at the top of the visible area.
 */
export const INITIAL_UNREAD_VIEW_POSITION = 1;

/**
 * How close to the newest message still counts as "following the live edge".
 * About one readable line plus a little breathing room.
 */
export const NEAR_BOTTOM_OFFSET = 100;

/**
 * First guess for an unmeasured row, matching React Native's own
 * `scrollToIndex` math (`offset = itemOffset - viewPosition * (viewport -
 * itemLength)`) with the list's measured average row height. Using the same
 * `viewPosition` here matters: the fallback must land near the FINAL position,
 * otherwise the retry visibly jumps from one end of the screen to the other.
 */
export function approximateScrollOffset(input: {
    index: number;
    averageItemLength: number;
    viewportHeight: number;
    viewPosition: number;
}): number {
    const itemLength = Math.max(1, input.averageItemLength);
    const viewport = Math.max(0, input.viewportHeight);
    const offset =
        itemLength * input.index -
        input.viewPosition * Math.max(0, viewport - itemLength);
    return Math.max(0, offset);
}

/**
 * A locally seeded (SQLite) conversation has no authoritative read position:
 * the stored rows do not contain one. If cached chat info does not provide it
 * either, "every message is unread" would anchor the list on the oldest saved
 * row instead of the latest message. Only anchor unread when the position is
 * known (or when the data came from the server, where `null` is meaningful:
 * a never-read chat).
 */
export function canAnchorUnread(input: {
    myLastSeenId: number | null;
    source: 'local' | 'server' | undefined;
}): boolean {
    return input.myLastSeenId !== null || input.source !== 'local';
}

/**
 * The one-time initial position may be applied only when every input it
 * depends on is final:
 *
 * - the loaded list is no longer empty,
 * - the header/composer/list are measured (their padding shifts every row of
 *   an inverted list, so anchoring earlier is a second, invisible movement),
 * - the read position is known (a SQLite seed carries none; waiting for the
 *   join ack avoids anchoring on the wrong target),
 * - no explicit jump is already in progress.
 */
export function canApplyInitialPosition(input: {
    alreadyPositioned: boolean;
    hasMessages: boolean;
    chromeMeasured: boolean;
    readPositionPending: boolean;
    jumpInProgress: boolean;
}): boolean {
    if (input.alreadyPositioned || !input.hasMessages) {
        return false;
    }
    if (!input.chromeMeasured || input.readPositionPending) {
        return false;
    }
    return !input.jumpInProgress;
}

/**
 * Whether an advanced newest message may move the list on its own.
 *
 * Only a settled initial position can follow a live message, and only while
 * the user is at the live edge and not dragging (or being animated by a jump).
 * Every non-scrollable data change — re-merges, edits, reactions, pagination
 * of older pages, attachment layout — keeps the same newest id and therefore
 * never reaches this point.
 */
export function shouldFollowNewest(input: {
    initialized: boolean;
    newestId: number | null;
    previousNewestId: number | null;
    atBottom: boolean;
    userScrolling: boolean;
    jumpInProgress: boolean;
}): boolean {
    if (!input.initialized || input.newestId === null) {
        return false;
    }
    if (input.newestId === input.previousNewestId) {
        return false;
    }
    if (!input.atBottom) {
        return false;
    }
    return !input.userScrolling && !input.jumpInProgress;
}

/** A failed `scrollToIndex` may be corrected while the budget lasts. */
export function canRetryScrollIndex(attempts: number): boolean {
    return attempts < MAX_SCROLL_INDEX_RETRIES;
}
