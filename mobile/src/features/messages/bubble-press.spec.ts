import {
    CHILD_PRESS_GUARD_MS,
    childPressBlocksMenu,
    resolveBubblePress,
} from './bubble-press';
import type { BubblePressState } from './bubble-press';

function state(overrides: Partial<BubblePressState> = {}): BubblePressState {
    return {
        selectionMode: false,
        status: 'sent',
        hasAttachments: false,
        hasConfirmedId: true,
        childHandled: false,
        ...overrides,
    };
}

describe('resolveBubblePress', () => {
    it('opens the menu for a confirmed bubble', () => {
        expect(resolveBubblePress(state())).toBe('menu');
    });

    it('selects in selection mode, even on a failed bubble', () => {
        expect(resolveBubblePress(state({ selectionMode: true }))).toBe(
            'select',
        );
        expect(
            resolveBubblePress(
                state({ selectionMode: true, status: 'failed' }),
            ),
        ).toBe('select');
    });

    it('retries a failed text bubble', () => {
        expect(
            resolveBubblePress(
                state({ status: 'failed', hasAttachments: false }),
            ),
        ).toBe('retry');
    });

    it('never opens a menu for a failed bubble with attachments', () => {
        expect(
            resolveBubblePress(
                state({ status: 'failed', hasAttachments: true }),
            ),
        ).toBe('none');
    });

    it('never opens a menu for a pending bubble', () => {
        expect(resolveBubblePress(state({ status: 'pending' }))).toBe('none');
        expect(
            resolveBubblePress(
                state({ status: 'pending', hasAttachments: true }),
            ),
        ).toBe('none');
    });

    it('does nothing without a confirmed id', () => {
        expect(resolveBubblePress(state({ hasConfirmedId: false }))).toBe(
            'none',
        );
    });

    it('does nothing when an interactive child handled the touch', () => {
        expect(resolveBubblePress(state({ childHandled: true }))).toBe('none');
    });
});

describe('childPressBlocksMenu', () => {
    it('does not block without a recorded child press', () => {
        expect(childPressBlocksMenu(0, 10_000)).toBe(false);
    });

    it('blocks within the guard window and releases after it', () => {
        expect(
            childPressBlocksMenu(1_000, 1_000 + CHILD_PRESS_GUARD_MS - 1),
        ).toBe(true);
        expect(childPressBlocksMenu(1_000, 1_000 + CHILD_PRESS_GUARD_MS)).toBe(
            false,
        );
    });
});
