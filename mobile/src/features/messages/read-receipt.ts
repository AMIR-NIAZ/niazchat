/**
 * Pure read-receipt decisions shared by the chat screen and `useMarkSeen`.
 *
 * Read state is driven by what is actually visible, not by sending a message
 * and not by reactions. The screen feeds the highest confirmed id among the
 * currently viewable rows; when the list is at the newest message it can skip
 * the viewability wait and use the newest confirmed id.
 */

/** Minimal row shape accepted from `onViewableItemsChanged`. */
export interface ViewableRow {
    kind: string;
    message?: { id: number | null } | undefined;
}

/** Minimal message shape accepted by the unread-block snapshot. */
export interface ReadableMessage {
    id: number | null;
    senderId: number;
}

/**
 * First message from someone else that sits above the stored read position.
 *
 * This is the unread-block anchor: it drives both the one-shot unread divider
 * and the initial read target when a chat is opened. Own messages, pending
 * rows (null id) and already-read history are skipped, so an optimistic bubble
 * can never anchor the divider and a re-render can never move the anchor down
 * the list.
 */
export function firstUnreadMessageId(input: {
    messages: readonly ReadableMessage[];
    myLastSeenId: number | null;
    currentUserId: number | null;
}): number | null {
    const myId = input.currentUserId ?? -1;
    for (const message of input.messages) {
        const id = message.id;
        if (id === null || !Number.isInteger(id) || id <= 0) {
            continue;
        }
        if (message.senderId === myId) {
            continue;
        }
        if (input.myLastSeenId !== null && id <= input.myLastSeenId) {
            continue;
        }
        return id;
    }
    return null;
}

/** Highest confirmed message id among visible rows; ignores separators/pending. */
export function highestVisibleMessageId(
    rows: readonly ViewableRow[],
): number | null {
    let highest: number | null = null;
    for (const row of rows) {
        if (row.kind !== 'message') {
            continue;
        }
        const id = row.message?.id;
        if (id === null || id === undefined || !Number.isInteger(id) || id <= 0) {
            continue;
        }
        highest = highest === null ? id : Math.max(highest, id);
    }
    return highest;
}

/**
 * The id to advance to. At the bottom the newest confirmed message is visible,
 * so it wins; while scrolled up only the highest actually visible message is
 * read. A null value means there is nothing safe to mark yet.
 */
export function pickReadTarget(input: {
    atBottom: boolean;
    newestConfirmedId: number | null;
    highestVisibleId: number | null;
}): number | null {
    return input.atBottom
        ? input.newestConfirmedId
        : input.highestVisibleId;
}

/** The monotonic/debounce gate used by `useMarkSeen`. */
export function shouldMarkSeen(input: {
    chatId: number | null;
    targetId: number | null;
    canMark: boolean;
    inFlight: boolean;
    acknowledgedId: number;
    attemptedId: number;
}): boolean {
    return (
        input.chatId !== null &&
        input.targetId !== null &&
        input.targetId > 0 &&
        input.canMark &&
        !input.inFlight &&
        input.targetId > Math.max(input.acknowledgedId, input.attemptedId)
    );
}

/** Base delay of the bounded retry for a transient `markSeen` failure. */
export const MARK_SEEN_RETRY_BASE_MS = 1500;
/** Retries after the first attempt; the receipt is never sent more often. */
export const MARK_SEEN_MAX_RETRIES = 2;

export type ReadReceiptPlan =
    | { readonly action: 'send'; readonly target: number }
    | { readonly action: 'wait'; readonly target: number; readonly delayMs: number }
    | { readonly action: 'idle' };

const IDLE: ReadReceiptPlan = { action: 'idle' };

/**
 * Read-receipt send decisions for one open chat, independent of React.
 *
 * A single `markSeen` position is kept per chat: monotonic, never while a
 * request is in flight, and never for the same position twice unless the
 * previous attempt FAILED transiently (network/ack timeout) or the app was
 * blurred/backgrounded in between. A permanently rejected id is not retried.
 *
 * This is what makes a receipt survive a transient failure instead of silently
 * disappearing until the next message arrives (the old behavior: `attemptedId`
 * blocked the same id forever, so a receipt lost to one ack timeout was only
 * re-sent when a NEWER message gave the hook a different target).
 */
export class ReadReceiptRunner {
    private chatId: number | null = null;
    private acknowledgedId = 0;
    private attemptedId = 0;
    private inFlight = false;
    private retries = 0;
    private retryAt: number | null = null;

    /** A different chat starts from zero (read positions are per chat). */
    reset(chatId: number | null): void {
        this.chatId = chatId;
        this.acknowledgedId = 0;
        this.attemptedId = 0;
        this.inFlight = false;
        this.retries = 0;
        this.retryAt = null;
    }

    private ensureChat(chatId: number | null): void {
        if (chatId !== this.chatId) {
            this.reset(chatId);
        }
    }

    plan(input: {
        chatId: number | null;
        targetId: number | null;
        canMark: boolean;
        now: number;
    }): ReadReceiptPlan {
        this.ensureChat(input.chatId);
        const { chatId, targetId } = input;
        if (
            chatId === null ||
            targetId === null ||
            targetId <= 0 ||
            !input.canMark ||
            this.inFlight
        ) {
            return IDLE;
        }
        // Already recorded (or a newer position was): nothing to send.
        if (targetId <= this.acknowledgedId) {
            return IDLE;
        }
        if (
            shouldMarkSeen({
                chatId,
                targetId,
                canMark: input.canMark,
                inFlight: this.inFlight,
                acknowledgedId: this.acknowledgedId,
                attemptedId: this.attemptedId,
            })
        ) {
            // A position beyond every attempt so far: always send it.
            this.retryAt = null;
            this.retries = 0;
            return { action: 'send', target: targetId };
        }
        // Same position, already attempted: only a pending retry may send it.
        if (this.retryAt === null) {
            return IDLE;
        }
        const remaining = this.retryAt - input.now;
        if (remaining > 0) {
            return { action: 'wait', target: targetId, delayMs: remaining };
        }
        this.attemptedId = this.acknowledgedId;
        this.retryAt = null;
        return { action: 'send', target: targetId };
    }

    /** Marks the target in flight; call before emitting `markSeen`. */
    begin(target: number): void {
        this.inFlight = true;
        this.attemptedId = target;
    }

    /** The server stored `effective` (its clamp may be lower than the target). */
    ack(effective: number): void {
        this.acknowledgedId = Math.max(this.acknowledgedId, effective);
        this.retries = 0;
        this.retryAt = null;
    }

    /**
     * A failed send. Transient failures get a bounded retry; a server
     * rejection (invalid/non-member) never gets hammered. Returns the retry
     * delay, or null when no retry will be scheduled.
     */
    fail(transient: boolean, now: number): number | null {
        if (!transient || this.retries >= MARK_SEEN_MAX_RETRIES) {
            this.retryAt = null;
            return null;
        }
        this.retries += 1;
        const delayMs = MARK_SEEN_RETRY_BASE_MS * this.retries;
        this.retryAt = now + delayMs;
        return delayMs;
    }

    finish(): void {
        this.inFlight = false;
    }

    /**
     * Focus/app-active lost: an unacknowledged position must be retried when
     * the user looks at the chat again (a receipt must never be dropped just
     * because the user backgrounded the app while it was in flight).
     */
    release(): void {
        if (this.inFlight) {
            return;
        }
        if (this.attemptedId > this.acknowledgedId) {
            this.attemptedId = this.acknowledgedId;
            this.retries = 0;
            this.retryAt = null;
        }
    }

    /** Socket reconnect: re-arm whatever was not acknowledged. */
    reconnect(): void {
        this.attemptedId = this.acknowledgedId;
        this.retries = 0;
        this.retryAt = null;
    }

    /** Read-only snapshot for tests/diagnostics. */
    snapshot(): {
        chatId: number | null;
        acknowledgedId: number;
        attemptedId: number;
        inFlight: boolean;
        retries: number;
        retryAt: number | null;
    } {
        return {
            chatId: this.chatId,
            acknowledgedId: this.acknowledgedId,
            attemptedId: this.attemptedId,
            inFlight: this.inFlight,
            retries: this.retries,
            retryAt: this.retryAt,
        };
    }
}
