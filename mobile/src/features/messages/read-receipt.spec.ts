import {
    firstUnreadMessageId,
    highestVisibleMessageId,
    pickReadTarget,
    shouldMarkSeen,
    type ReadableMessage,
    type ViewableRow,
} from './read-receipt';

function messageRow(id: number | null): ViewableRow {
    return { kind: 'message', message: { id } };
}

describe('read receipts', () => {
    it('Scenario A: opening on the unread divider targets the visible message, no send needed', () => {
        const target = pickReadTarget({
            atBottom: false,
            newestConfirmedId: 50,
            highestVisibleId: 42,
        });
        expect(target).toBe(42);
        expect(
            shouldMarkSeen({
                chatId: 1,
                targetId: target,
                canMark: true,
                inFlight: false,
                acknowledgedId: 0,
                attemptedId: 0,
            }),
        ).toBe(true);
    });

    it('Scenario B: a blurred/left chat cannot send a read receipt', () => {
        expect(
            shouldMarkSeen({
                chatId: 1,
                targetId: 42,
                // Switching to another group clears focus; no event for chat 1.
                canMark: false,
                inFlight: false,
                acknowledgedId: 0,
                attemptedId: 0,
            }),
        ).toBe(false);
    });

    it('Scenario C: a newly visible message advances the target exactly once', () => {
        const base = {
            chatId: 1,
            canMark: true,
            inFlight: false,
            acknowledgedId: 41,
            attemptedId: 41,
        };
        expect(shouldMarkSeen({ ...base, targetId: 42 })).toBe(true);
        expect(shouldMarkSeen({ ...base, targetId: 41 })).toBe(false);
    });

    it('Scenario D: target selection only uses visibility, never reactions', () => {
        const visible = [messageRow(10), messageRow(12), messageRow(null)];
        // Reactions do not appear in this input at all, so toggling one can
        // never change the read target by itself.
        expect(highestVisibleMessageId(visible)).toBe(12);
        expect(
            pickReadTarget({
                atBottom: false,
                newestConfirmedId: 99,
                highestVisibleId: 12,
            }),
        ).toBe(12);
    });

    it('Scenario E: reconnecting re-arms the same target', () => {
        // A reconnect resets attemptedId to 0 in the hook.
        expect(
            shouldMarkSeen({
                chatId: 1,
                targetId: 42,
                canMark: true,
                inFlight: false,
                acknowledgedId: 0,
                attemptedId: 0,
            }),
        ).toBe(true);
    });

    it('Scenario F: several visible unread messages collapse into one target', () => {
        expect(
            highestVisibleMessageId([
                messageRow(40),
                { kind: 'day' },
                messageRow(41),
                { kind: 'unread' },
                messageRow(42),
            ]),
        ).toBe(42);
    });

    it('ignores separators, pending rows and invalid ids', () => {
        expect(
            highestVisibleMessageId([
                { kind: 'unread' },
                messageRow(null),
                messageRow(0),
                messageRow(-3),
                { kind: 'message' },
            ]),
        ).toBeNull();
    });

    it('prefers the newest message when the list is at the bottom', () => {
        expect(
            pickReadTarget({
                atBottom: true,
                newestConfirmedId: 50,
                highestVisibleId: 42,
            }),
        ).toBe(50);
    });
});

describe('unread block snapshot', () => {
    function row(id: number | null, senderId = 2): ReadableMessage {
        return { id, senderId };
    }

    it('Scenario A: the first unread message from another member anchors it', () => {
        expect(
            firstUnreadMessageId({
                messages: [row(41), row(42), row(43)],
                myLastSeenId: 41,
                currentUserId: 1,
            }),
        ).toBe(42);
    });

    it('ignores own messages, pending rows and already-read history', () => {
        expect(
            firstUnreadMessageId({
                messages: [row(10, 1), row(null), row(11, 1), row(12)],
                myLastSeenId: 10,
                currentUserId: 1,
            }),
        ).toBe(12);
    });

    it('treats a never-read chat as fully unread', () => {
        expect(
            firstUnreadMessageId({
                messages: [row(7)],
                myLastSeenId: null,
                currentUserId: 1,
            }),
        ).toBe(7);
    });

    it('returns null when nothing from another member is unread', () => {
        expect(
            firstUnreadMessageId({
                messages: [row(9, 1)],
                myLastSeenId: null,
                currentUserId: 1,
            }),
        ).toBeNull();
        expect(
            firstUnreadMessageId({
                messages: [row(9), row(10)],
                myLastSeenId: 10,
                currentUserId: 1,
            }),
        ).toBeNull();
    });

    it('Scenario A regression: opening on the divider has a target with no list change', () => {
        // The initial positioning effect uses the snapshot's message as the
        // visible target. Before the fix the snapshot and the positioning ran
        // in two effects, so positioning saw a stale null divider, enabled
        // tracking with no target, and sent no markSeen until the next list
        // change (sending a message, reacting, or a new arrival).
        const dividerId = firstUnreadMessageId({
            messages: [row(41), row(42), row(43)],
            myLastSeenId: 41,
            currentUserId: 1,
        });
        const target = pickReadTarget({
            atBottom: false,
            newestConfirmedId: 43,
            highestVisibleId: dividerId,
        });
        expect(target).toBe(42);
        expect(
            shouldMarkSeen({
                chatId: 1,
                targetId: target,
                canMark: true,
                inFlight: false,
                acknowledgedId: 0,
                attemptedId: 0,
            }),
        ).toBe(true);
    });
});
