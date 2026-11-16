/**
 * Plain-TS unit tests for the music player's play-order logic (no test
 * framework is installed in the mobile package).
 *
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' mobile/test/music-queue.test.ts
 */
import {
    MUSIC_PLAY_ORDERS,
    SHUFFLE_HISTORY_LIMIT,
    buildQueueOrder,
    createQueueCursor,
    nextIndex,
    peekNextIndex,
    previousIndex,
    shuffleBag,
    startShuffleRound,
    syncQueueCursor,
    type MusicQueueCursor,
} from '../src/shared/music-player/music-queue';

let failures = 0;

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL ${name}`);
        console.error(error instanceof Error ? error.stack : error);
    }
}

function assertEqual<T>(actual: T, expected: T, label = ''): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${label} expected ${e}, got ${a}`);
}

function assertTrue(value: boolean, label: string): void {
    if (!value) throw new Error(label);
}

/** Deterministic RNG so permutations are reproducible. */
function seeded(values: number[]): () => number {
    let index = 0;
    return (): number => {
        const value = values[index % values.length] ?? 0.5;
        index += 1;
        return value;
    };
}

function sorted(values: readonly number[]): number[] {
    return [...values].sort((left, right) => left - right);
}

/** Walks `steps` next() calls and returns the indexes in play order. */
function walk(
    cursor: MusicQueueCursor,
    current: number,
    length: number,
    steps: number,
): { indexes: number[]; cursor: MusicQueueCursor } {
    const indexes: number[] = [];
    let state = cursor;
    let position = current;
    for (let step = 0; step < steps; step += 1) {
        const result = nextIndex(state, position, length);
        state = result.cursor;
        position = result.index;
        indexes.push(position);
    }
    return { indexes, cursor: state };
}

test('forward order is the list, backward is its reverse', () => {
    assertEqual(buildQueueOrder(4, 'forward'), [0, 1, 2, 3]);
    assertEqual(buildQueueOrder(4, 'backward'), [3, 2, 1, 0]);
    assertEqual(buildQueueOrder(0, 'forward'), []);
});

test('shuffle permutation contains every index exactly once', () => {
    const bag = shuffleBag(6, -1, seeded([0.1, 0.9, 0.4, 0.7, 0.2]));
    assertEqual(sorted(bag), [0, 1, 2, 3, 4, 5]);
    const pinned = shuffleBag(6, 3, seeded([0.5, 0.25, 0.75]));
    assertEqual(pinned[0], 3);
    assertEqual(sorted(pinned), [0, 1, 2, 3, 4, 5]);
});

test('forward wraps at the end and the start', () => {
    const cursor = createQueueCursor(4, 0, 'forward');
    assertEqual(nextIndex(cursor, 3, 4).index, 0, 'last → first');
    assertEqual(previousIndex(cursor, 0, 4).index, 3, 'first → last');
    assertEqual(nextIndex(cursor, 1, 4).index, 2);
    assertEqual(previousIndex(cursor, 2, 4).index, 1);
    // The whole queue plays round and round without stopping.
    assertEqual(walk(cursor, 0, 4, 9).indexes, [1, 2, 3, 0, 1, 2, 3, 0, 1]);
});

test('backward walks the list in reverse and wraps', () => {
    const cursor = createQueueCursor(4, 0, 'backward');
    assertEqual(nextIndex(cursor, 0, 4).index, 3, 'first → last');
    assertEqual(previousIndex(cursor, 0, 4).index, 1, 'first → second');
    assertEqual(nextIndex(cursor, 3, 4).index, 2);
    assertEqual(walk(cursor, 3, 4, 6).indexes, [2, 1, 0, 3, 2, 1]);
});

test('a single-track queue repeats that track forever', () => {
    const forward = createQueueCursor(1, 0, 'forward');
    assertEqual(nextIndex(forward, 0, 1).index, 0);
    assertEqual(previousIndex(forward, 0, 1).index, 0);
    const shuffle = createQueueCursor(1, 0, 'shuffle');
    const played = walk(shuffle, 0, 1, 5);
    assertEqual(played.indexes, [0, 0, 0, 0, 0]);
    assertTrue(
        played.indexes.every((index) => index >= 0),
        'single-track shuffle never ends the queue',
    );
});

test('shuffle starts with the current track and never repeats it in a round', () => {
    const cursor = createQueueCursor(5, 2, 'shuffle', seeded([0.2, 0.8, 0.4]));
    assertEqual(cursor.shuffle.history, [2]);
    assertEqual(sorted([...cursor.shuffle.bag, 2]), [0, 1, 2, 3, 4]);

    const round = walk(cursor, 2, 5, 4);
    assertEqual(sorted(round.indexes), [0, 1, 3, 4]);
    assertTrue(
        round.indexes.every((index) => index !== 2),
        'the playing track is not repeated inside its round',
    );
    // The next round never starts with the track that just finished.
    const boundary = nextIndex(round.cursor, round.indexes[3] ?? 0, 5);
    assertTrue(
        boundary.index !== (round.indexes[3] ?? -1),
        'round boundary must not repeat the last played track',
    );
});

test('shuffle previous() walks history, next() then goes forward through it', () => {
    const start = createQueueCursor(5, 2, 'shuffle', seeded([0.3, 0.6, 0.9]));
    const first = nextIndex(start, 2, 5);
    const second = nextIndex(first.cursor, first.index, 5);

    const back = previousIndex(second.cursor, second.index, 5);
    assertEqual(back.index, first.index, 'previous → previously played track');
    assertEqual(back.cursor.shuffle.cursor, 1);
    const startAgain = previousIndex(back.cursor, back.index, 5);
    assertEqual(startAgain.index, 2, 'previous → the track before it');

    const forwardAgain = nextIndex(startAgain.cursor, 2, 5);
    assertEqual(forwardAgain.index, first.index, 'next → forward in history');
    const forwardTwice = nextIndex(forwardAgain.cursor, forwardAgain.index, 5);
    assertEqual(
        forwardTwice.index,
        second.index,
        'next → still forward in history, before the bag',
    );
    // Only after reaching the end of the history does the bag continue.
    const afterHistory = nextIndex(forwardTwice.cursor, forwardTwice.index, 5);
    assertTrue(
        afterHistory.index !== first.index &&
            afterHistory.index !== second.index &&
            afterHistory.index !== 2,
        'a new track comes from the bag',
    );
});

test('shuffle history is capped at 50 entries', () => {
    let cursor = createQueueCursor(12, 0, 'shuffle');
    let current = 0;
    for (let step = 0; step < 80; step += 1) {
        const result = nextIndex(cursor, current, 12);
        cursor = result.cursor;
        current = result.index;
    }
    assertEqual(cursor.shuffle.history.length, SHUFFLE_HISTORY_LIMIT);
    assertEqual(cursor.shuffle.history.at(-1), current);
    assertEqual(cursor.shuffle.cursor, SHUFFLE_HISTORY_LIMIT - 1);
});

test('switching to shuffle mid-playback rebuilds the bag from the current track', () => {
    const shuffle = createQueueCursor(4, 2, 'shuffle');
    assertEqual(shuffle.shuffle.history, [2]);
    assertEqual(shuffle.shuffle.bag.length, 3);
    assertTrue(
        !shuffle.shuffle.bag.includes(2),
        'the current track is not in the bag',
    );
    // Back to forward: the position in the list is the reference again.
    const forward = createQueueCursor(4, 2, 'forward');
    assertEqual(nextIndex(forward, 2, 4).index, 3);
    assertEqual(previousIndex(forward, 2, 4).index, 1);
});

test('live append keeps the cursor and inserts the new track into the bag', () => {
    const cursor = createQueueCursor(3, 1, 'shuffle', seeded([0.5]));
    const grown = syncQueueCursor(cursor, [0, 1, 2], 4, 1, seeded([0.5]));
    assertEqual(grown.length, 4);
    assertEqual(grown.shuffle.history, [1]);
    assertEqual(sorted([...grown.shuffle.bag, 1]), [0, 1, 2, 3]);
    assertEqual(grown.shuffle.cursor, 0);

    // A track appended while it was the only one still becomes reachable.
    const single = syncQueueCursor(
        createQueueCursor(1, 0, 'shuffle'),
        [0],
        2,
        0,
        seeded([0.99]),
    );
    assertEqual(single.shuffle.bag, [1]);
});

test('live removal remaps history and bag; the current track stays current', () => {
    // Queue was [0, 1, 2, 3]; track 1 was deleted, so now [0, 1, 2] where the
    // old 2 is index 1 and the old 3 is index 2.
    const cursor = createQueueCursor(4, 2, 'shuffle', seeded([0.2, 0.7]));
    const synced = syncQueueCursor(cursor, [0, null, 1, 2], 3, 1);
    assertEqual(synced.length, 3);
    assertEqual(synced.shuffle.history, [1]);
    assertEqual(synced.shuffle.cursor, 0);
    for (const index of synced.shuffle.bag) {
        assertTrue(index >= 0 && index < 3, 'bag indexes are in range');
    }
});

test('removal while paused keeps forward/backward on the list position', () => {
    const cursor = createQueueCursor(3, 1, 'backward');
    const synced = syncQueueCursor(cursor, [0, 1], 2, 1);
    assertEqual(synced.length, 2);
    assertEqual(nextIndex(synced, 1, 2).index, 0);
    assertEqual(previousIndex(synced, 1, 2).index, 0);
});

test('peekNextIndex does not consume the shuffle bag', () => {
    const cursor = createQueueCursor(4, 1, 'shuffle', seeded([0.9, 0.1, 0.5]));
    const peek = peekNextIndex(cursor, 1, 4);
    assertEqual(cursor.shuffle.bag.length, 3, 'bag unchanged by the peek');
    assertEqual(nextIndex(cursor, 1, 4).index, peek);
    assertEqual(startShuffleRound(0, 0).history, []);
    assertEqual(MUSIC_PLAY_ORDERS, ['forward', 'backward', 'shuffle']);
});

test('an empty queue always reports -1 (nothing to play)', () => {
    const cursor = createQueueCursor(0, 0, 'shuffle');
    assertEqual(nextIndex(cursor, 0, 0).index, -1);
    assertEqual(previousIndex(cursor, 0, 0).index, -1);
});

if (failures > 0) {
    console.error(`${failures} test(s) failed`);
    const nodeProcess = (globalThis as { process?: { exitCode?: number } })
        .process;
    if (nodeProcess !== undefined) nodeProcess.exitCode = 1;
} else {
    console.log('All music queue tests passed');
}
