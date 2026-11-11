import {
    MARK_SEEN_MAX_RETRIES,
    MARK_SEEN_RETRY_BASE_MS,
    ReadReceiptRunner,
    firstUnreadMessageId,
    highestVisibleMessageId,
    pickReadTarget,
} from './read-receipt';

/**
 * Scenario coverage for the read-receipt lifecycle, at the same decision level
 * `useMarkSeen` uses. The hook is a thin adapter over `ReadReceiptRunner`, so
 * these tests exercise the exact duplicate/retry/reconnect rules that decide
 * whether and when `markSeen` is emitted.
 */

const T0 = 1_000_000;

function plan(
    runner: ReadReceiptRunner,
    chatId: number,
    targetId: number,
    now = T0,
): ReturnType<ReadReceiptRunner['plan']> {
    return runner.plan({ chatId, targetId, canMark: true, now });
}

describe('read receipt lifecycle', () => {
    it('Test 1 — reading a private message sends its receipt without sending another message', () => {
        const runner = new ReadReceiptRunner();
        runner.reset(1);

        // Opening on the unread divider: the visible message is the target.
        const divider = firstUnreadMessageId({
            messages: [
                { id: 41, senderId: 1 },
                { id: 42, senderId: 2 },
                { id: 43, senderId: 2 },
            ],
            myLastSeenId: 41,
            currentUserId: 1,
        });
        const target = pickReadTarget({
            atBottom: false,
            newestConfirmedId: 43,
            highestVisibleId: divider,
        });
        expect(target).toBe(42);

        expect(plan(runner, 1, target!)).toEqual({
            action: 'send',
            target: 42,
        });
        runner.begin(42);

        // No duplicate while the ack is outstanding.
        expect(plan(runner, 1, 42)).toEqual({ action: 'idle' });

        runner.ack(42);
        runner.finish();
        expect(plan(runner, 1, 42)).toEqual({ action: 'idle' });
        expect(plan(runner, 1, 43)).toEqual({
            action: 'send',
            target: 43,
        });
    });

    it('Test 2 — switching conversations never reuses the previous chat position', () => {
        const runner = new ReadReceiptRunner();

        runner.reset(7);
        expect(plan(runner, 7, 10)).toEqual({ action: 'send', target: 10 });
        runner.begin(10);
        runner.ack(10);
        runner.finish();
        expect(runner.snapshot().acknowledgedId).toBe(10);

        // Chat 8 has its own read position: the switch clears the gate, so a
        // lower id is a legitimate first read there (the old position 10 must
        // not suppress it), and chat 8's ack does not leak back to chat 7.
        runner.reset(8);
        expect(runner.snapshot()).toMatchObject({
            chatId: 8,
            acknowledgedId: 0,
            attemptedId: 0,
        });
        expect(plan(runner, 8, 4)).toEqual({ action: 'send', target: 4 });
        runner.begin(4);
        runner.ack(4);
        runner.finish();
        expect(plan(runner, 8, 4)).toEqual({ action: 'idle' });

        // Re-entering chat 7 starts from zero again: the receipt is resent and
        // the server's monotonic store is what makes it a no-op, not stale
        // client state suppressing it.
        runner.reset(7);
        expect(plan(runner, 7, 10)).toEqual({ action: 'send', target: 10 });
    });

    it('Test 3 — repeated switching and duplicate evaluation never double-send', () => {
        const runner = new ReadReceiptRunner();

        for (const [chatId, target] of [
            [1, 5],
            [2, 9],
            [1, 6],
            [2, 10],
            [1, 7],
        ] as const) {
            runner.reset(chatId);
            expect(plan(runner, chatId, target)).toEqual({
                action: 'send',
                target,
            });
            // Duplicate listener/evaluation with the same target: still one send.
            expect(plan(runner, chatId, target)).toEqual({ action: 'send', target });
            runner.begin(target);
            expect(plan(runner, chatId, target)).toEqual({ action: 'idle' });
            runner.ack(target);
            runner.finish();
            expect(plan(runner, chatId, target)).toEqual({ action: 'idle' });
        }
    });

    it('Test 4 — a transient failure is retried, and a reconnect re-arms the same receipt', () => {
        const runner = new ReadReceiptRunner();
        runner.reset(3);

        expect(plan(runner, 3, 20)).toEqual({ action: 'send', target: 20 });
        runner.begin(20);
        const delay = runner.fail(true, T0);
        runner.finish();
        expect(delay).toBe(MARK_SEEN_RETRY_BASE_MS);

        // Cooling down: no hot loop, just a scheduled retry.
        expect(plan(runner, 3, 20, T0 + 1)).toEqual({
            action: 'wait',
            target: 20,
            delayMs: MARK_SEEN_RETRY_BASE_MS - 1,
        });
        runner.release(); // focus lost before the retry timer fires

        // Reconnect/focus re-arms the unacknowledged position.
        runner.reconnect();
        expect(plan(runner, 3, 20, T0 + MARK_SEEN_RETRY_BASE_MS)).toEqual({
            action: 'send',
            target: 20,
        });
        runner.begin(20);
        runner.ack(20);
        runner.finish();
        expect(plan(runner, 3, 20)).toEqual({ action: 'idle' });
    });

    it('Test 4b — retries are bounded and a server rejection is never retried', () => {
        const runner = new ReadReceiptRunner();
        runner.reset(3);

        expect(plan(runner, 3, 20)).toEqual({ action: 'send', target: 20 });
        runner.begin(20);
        expect(runner.fail(false, T0)).toBeNull(); // 4xx: deterministic
        runner.finish();
        expect(plan(runner, 3, 20)).toEqual({ action: 'idle' });

        runner.reconnect();
        let now = T0;
        for (let attempt = 0; attempt <= MARK_SEEN_MAX_RETRIES; attempt += 1) {
            expect(plan(runner, 3, 20, now)).toEqual({
                action: 'send',
                target: 20,
            });
            runner.begin(20);
            const delay = runner.fail(true, now);
            runner.finish();
            if (attempt < MARK_SEEN_MAX_RETRIES) {
                expect(delay).not.toBeNull();
                now += delay ?? 0;
            } else {
                expect(delay).toBeNull();
            }
        }
        expect(plan(runner, 3, 20, now + 10_000)).toEqual({ action: 'idle' });
    });

    it('Test 5 — several incoming messages collapse into the newest receipt, persisted once per position', () => {
        const runner = new ReadReceiptRunner();
        runner.reset(9);

        expect(plan(runner, 9, 50)).toEqual({ action: 'send', target: 50 });
        runner.begin(50);

        // Messages 51..53 arrive while 50 is in flight: no parallel requests.
        expect(plan(runner, 9, 51)).toEqual({ action: 'idle' });
        expect(plan(runner, 9, 53)).toEqual({ action: 'idle' });

        runner.ack(50);
        runner.finish();
        // Only the newest eligible position is sent next, not 51 then 52 then 53.
        expect(plan(runner, 9, 51)).toEqual({ action: 'send', target: 51 });
        runner.begin(51);
        runner.ack(53); // server already accepted a higher position
        runner.finish();
        expect(plan(runner, 9, 53)).toEqual({ action: 'idle' });
    });

    it('Test 6 — group behaviour is identical (newest visible / highest visible target)', () => {
        const runner = new ReadReceiptRunner();
        runner.reset(11); // group chat id

        // Reading older history in a group advances only to what is visible.
        expect(
            plan(
                runner,
                11,
                pickReadTarget({
                    atBottom: false,
                    newestConfirmedId: 80,
                    highestVisibleId: 75,
                })!,
            ),
        ).toEqual({ action: 'send', target: 75 });
        expect(highestVisibleMessageId([{ kind: 'message', message: { id: 75 } }])).toBe(75);
        runner.begin(75);
        runner.ack(75);
        runner.finish();

        // At the bottom the newest confirmed message wins.
        expect(
            plan(
                runner,
                11,
                pickReadTarget({
                    atBottom: true,
                    newestConfirmedId: 80,
                    highestVisibleId: 71,
                })!,
            ),
        ).toEqual({ action: 'send', target: 80 });
        runner.begin(80);
        runner.ack(80);
        runner.finish();
        // Monotonic: scrolling back up can never regress the position.
        expect(plan(runner, 11, 75)).toEqual({ action: 'idle' });
    });

    it('Test 7 — a message that arrives before the list is positioned is read afterwards, not lost', () => {
        const runner = new ReadReceiptRunner();
        runner.reset(12);

        // getMessages/joinChat finished but initial positioning is not ready.
        expect(
            runner.plan({
                chatId: 12,
                targetId: 60,
                canMark: false,
                now: T0,
            }),
        ).toEqual({ action: 'idle' });

        // Once positioned, the same target is sent exactly once.
        expect(plan(runner, 12, 60, T0 + 500)).toEqual({
            action: 'send',
            target: 60,
        });
        runner.begin(60);
        // The user switches away before the ack lands (blur -> release).
        runner.fail(true, T0 + 500);
        runner.finish();
        runner.release();

        // Coming back re-sends it; nothing was lost just because the list was
        // still loading when `markSeen` was first evaluated.
        expect(plan(runner, 12, 60, T0 + 10_000)).toEqual({
            action: 'send',
            target: 60,
        });
    });
});
