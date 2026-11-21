import {
    approximateScrollOffset,
    canAnchorUnread,
    canApplyInitialPosition,
    canRetryScrollIndex,
    INITIAL_UNREAD_VIEW_POSITION,
    MAX_SCROLL_INDEX_RETRIES,
    NEAR_BOTTOM_OFFSET,
    shouldFollowNewest,
} from './chat-scroll';

const ready = {
    alreadyPositioned: false,
    hasMessages: true,
    chromeMeasured: true,
    readPositionPending: false,
    jumpInProgress: false,
} as const;

describe('canApplyInitialPosition', () => {
    it('positions once the list, chrome and read position are ready', () => {
        expect(canApplyInitialPosition(ready)).toBe(true);
    });

    it('never repositions an already positioned list', () => {
        expect(
            canApplyInitialPosition({ ...ready, alreadyPositioned: true }),
        ).toBe(false);
    });

    it('waits for the first message and the measured chrome', () => {
        expect(canApplyInitialPosition({ ...ready, hasMessages: false })).toBe(
            false,
        );
        expect(
            canApplyInitialPosition({ ...ready, chromeMeasured: false }),
        ).toBe(false);
    });

    it('waits for the read position of a locally seeded conversation', () => {
        expect(
            canApplyInitialPosition({ ...ready, readPositionPending: true }),
        ).toBe(false);
    });

    it('lets an explicit jump keep the position it owns', () => {
        expect(
            canApplyInitialPosition({ ...ready, jumpInProgress: true }),
        ).toBe(false);
    });
});

describe('shouldFollowNewest', () => {
    const base = {
        initialized: true,
        newestId: 12,
        previousNewestId: 11,
        atBottom: true,
        userScrolling: false,
        jumpInProgress: false,
    } as const;

    it('follows a genuinely new message at the live edge', () => {
        expect(shouldFollowNewest(base)).toBe(true);
    });

    it('does nothing before the initial position is settled', () => {
        expect(shouldFollowNewest({ ...base, initialized: false })).toBe(false);
    });

    it('does nothing when the newest id did not advance', () => {
        expect(shouldFollowNewest({ ...base, previousNewestId: 12 })).toBe(
            false,
        );
    });

    it('never moves a user who is reading older messages', () => {
        expect(shouldFollowNewest({ ...base, atBottom: false })).toBe(false);
    });

    it('never fights a drag, momentum or an in-flight jump', () => {
        expect(shouldFollowNewest({ ...base, userScrolling: true })).toBe(
            false,
        );
        expect(shouldFollowNewest({ ...base, jumpInProgress: true })).toBe(
            false,
        );
    });

    it('does nothing without a confirmed id', () => {
        expect(
            shouldFollowNewest({
                ...base,
                newestId: null,
                previousNewestId: null,
            }),
        ).toBe(false);
    });
});

describe('initialization sequences', () => {
    it('applies the initial position exactly once, after the server pass', () => {
        // Stage 1: SQLite seed (no read position) while the join is in flight.
        const seeded = {
            alreadyPositioned: false,
            hasMessages: true,
            chromeMeasured: true,
            readPositionPending: true,
            jumpInProgress: false,
        };
        expect(canApplyInitialPosition(seeded)).toBe(false);

        // Stage 2: join ack supplied the read position and the page.
        expect(
            canApplyInitialPosition({ ...seeded, readPositionPending: false }),
        ).toBe(true);

        // Stage 3+: pagination, image layout and re-merges never re-anchor.
        expect(
            canApplyInitialPosition({
                ...seeded,
                readPositionPending: false,
                alreadyPositioned: true,
            }),
        ).toBe(false);
    });

    it('does not follow the initial page when the anchor is set', () => {
        // The initial pass records the newest id: the same data must not be
        // mistaken for a live arrival and scroll to offset 0 behind it.
        expect(
            shouldFollowNewest({
                initialized: true,
                newestId: 40,
                previousNewestId: 40,
                atBottom: false,
                userScrolling: false,
                jumpInProgress: false,
            }),
        ).toBe(false);
    });

    it('follows live messages only at the edge, never while reading back', () => {
        const live = {
            initialized: true,
            newestId: 41,
            previousNewestId: 40,
            userScrolling: false,
            jumpInProgress: false,
        };
        expect(shouldFollowNewest({ ...live, atBottom: true })).toBe(true);
        expect(shouldFollowNewest({ ...live, atBottom: false })).toBe(false);
    });
});

describe('canRetryScrollIndex', () => {
    it('allows a bounded number of corrections', () => {
        for (
            let attempts = 0;
            attempts < MAX_SCROLL_INDEX_RETRIES;
            attempts += 1
        ) {
            expect(canRetryScrollIndex(attempts)).toBe(true);
        }
        expect(canRetryScrollIndex(MAX_SCROLL_INDEX_RETRIES)).toBe(false);
        expect(canRetryScrollIndex(MAX_SCROLL_INDEX_RETRIES + 5)).toBe(false);
    });
});

describe('approximateScrollOffset', () => {
    it('matches the final viewPosition instead of bouncing to the bottom', () => {
        // 10 average rows down, one screen tall: the top anchor (viewPosition
        // 1) is one viewport less one row from the bottom edge.
        expect(
            approximateScrollOffset({
                index: 10,
                averageItemLength: 100,
                viewportHeight: 800,
                viewPosition: INITIAL_UNREAD_VIEW_POSITION,
            }),
        ).toBe(300);
        expect(
            approximateScrollOffset({
                index: 10,
                averageItemLength: 100,
                viewportHeight: 800,
                viewPosition: 0,
            }),
        ).toBe(1000);
    });

    it('never returns a negative offset (a target near the newest edge clamps)', () => {
        expect(
            approximateScrollOffset({
                index: 1,
                averageItemLength: 100,
                viewportHeight: 800,
                viewPosition: INITIAL_UNREAD_VIEW_POSITION,
            }),
        ).toBe(0);
        expect(
            approximateScrollOffset({
                index: 0,
                averageItemLength: 0,
                viewportHeight: 0,
                viewPosition: 1,
            }),
        ).toBe(0);
    });
});

describe('canAnchorUnread', () => {
    it('anchors a server page with a known position', () => {
        expect(canAnchorUnread({ myLastSeenId: 41, source: 'server' })).toBe(
            true,
        );
    });

    it('anchors a never-read server chat (null is meaningful there)', () => {
        expect(canAnchorUnread({ myLastSeenId: null, source: 'server' })).toBe(
            true,
        );
    });

    it('anchors a local seed only when cached chat info supplied the position', () => {
        expect(canAnchorUnread({ myLastSeenId: 41, source: 'local' })).toBe(
            true,
        );
        // Unknown read position + saved rows: open at latest, not at the
        // oldest saved row.
        expect(canAnchorUnread({ myLastSeenId: null, source: 'local' })).toBe(
            false,
        );
    });
});

describe('scroll constants', () => {
    it('opens the first unread at the visual top of an inverted list', () => {
        expect(INITIAL_UNREAD_VIEW_POSITION).toBe(1);
    });

    it('counts roughly one line plus breathing room as near the bottom', () => {
        expect(NEAR_BOTTOM_OFFSET).toBe(100);
    });
});
