import { chatListGeometry } from './chat-list-geometry';
import type { ChatListGeometryInput } from './chat-list-geometry';

const BASE: ChatListGeometryInput = {
    headerHeight: 120, // safe-area top 24 + 96 px header pill
    composerHeight: 56,
    noticesHeight: 0,
    bottomMargin: 24,
    musicBarStrip: 0,
    fadeExtra: 100,
    gap: 12,
    listHeight: 800,
};

function geometry(overrides: Partial<ChatListGeometryInput>) {
    return chatListGeometry({ ...BASE, ...overrides });
}

/** Share of the list viewport left for messages. */
function visibleRatio(
    result: ReturnType<typeof chatListGeometry>,
    listHeight: number,
): number {
    return (
        (listHeight - result.listPaddingTop - result.listPaddingBottom) /
        listHeight
    );
}

it('the keyboard never changes the padding or the fades', () => {
    // The keyboard moves the composer up AND shortens the frame by the same
    // amount, so every value derived from the overlap is identical. The old
    // code read the keyboard inset directly, which is how it got double counted.
    const closed = geometry({ listHeight: 800 });
    const openAndroid = geometry({ listHeight: 500 });
    const openIos = geometry({ listHeight: 460 });
    expect(openAndroid).toEqual(closed);
    expect(openIos).toEqual(closed);
    expect(closed.composerOverlap).toBe(56 + 0 + 24);
    expect(closed.listPaddingTop).toBe(92);
    expect(closed.listPaddingBottom).toBe(132);
});

it('keyboard-open frames keep more than half the view for messages', () => {
    const cases: Array<{
        name: string;
        input: Partial<ChatListGeometryInput>;
        listHeight: number;
    }> = [
        {
            name: 'short chat, keyboard closed',
            input: { listHeight: 800 },
            listHeight: 800,
        },
        {
            name: 'keyboard open (Android IME 300)',
            input: { listHeight: 500 },
            listHeight: 500,
        },
        {
            name: 'keyboard open (iOS IME 344)',
            input: { listHeight: 460 },
            listHeight: 460,
        },
        {
            name: 'keyboard open + reply preview',
            input: { listHeight: 460, composerHeight: 110 },
            listHeight: 460,
        },
        {
            name: 'keyboard open + reply + notices',
            input: { listHeight: 460, composerHeight: 110, noticesHeight: 40 },
            listHeight: 460,
        },
        {
            name: 'keyboard open + mini player bar',
            input: { listHeight: 500, musicBarStrip: 50 },
            listHeight: 500,
        },
    ];
    for (const entry of cases) {
        const result = geometry(entry.input);
        expect(visibleRatio(result, entry.listHeight)).toBeGreaterThanOrEqual(
            0.5,
        );
    }
});

it('the pre-fix values pushed every message out of the open view', () => {
    // Old formula: composerHeight + notices + (bottomMargin + keyboardInset),
    // then + 12. With a 300 px Android inset that is 392 px of padding inside a
    // 500 px frame, and the bottom fade alone was 480 px.
    const listHeight = 500;
    const oldPaddingTop = 56 + 0 + (24 + 300) + 12;
    const oldBottomFade = 56 + 0 + (24 + 300) + 100;
    const oldVisible = listHeight - oldPaddingTop - (120 + 12);
    expect(oldPaddingTop).toBe(392);
    expect(oldVisible).toBeLessThan(0); // 96 px of padding > 500 - 132
    expect(oldBottomFade + (120 + 100)).toBeGreaterThan(listHeight);

    const fixed = geometry({ listHeight });
    expect(fixed.listPaddingTop).toBe(92);
    expect(fixed.listPaddingBottom).toBe(132);
    // 500 - 92 - 132 = 276 px of message area (55 %).
    expect(visibleRatio(fixed, listHeight)).toBeCloseTo(0.552, 3);
});
