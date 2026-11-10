/**
 * Globally unique local keys for optimistic messages and selected files.
 *
 * A module-level counter (never reset by a remount or Fast Refresh) plus a
 * timestamp and random suffix means two screens/visits can never produce the
 * same key. This replaces the old per-mount `useRef` counter that restarted at
 * 1 and collided with cached bubbles (`pending-1`).
 */
let sequence = 0;

function uniquePart(): string {
    sequence += 1;
    return `${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

/** FlatList key for one optimistic message (no extra `pending-` prefix). */
export function nextPendingMessageKey(): string {
    return `p-${uniquePart()}`;
}

/** Echo-matching id sent over the socket. */
export function nextClientMessageId(): string {
    return `c-${uniquePart()}`;
}

/** Stable key for one locally selected file (picker tray + attachment tile). */
export function nextSelectionKey(): string {
    return `sel-${uniquePart()}`;
}
