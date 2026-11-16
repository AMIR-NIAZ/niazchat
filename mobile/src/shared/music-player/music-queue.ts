/**
 * Pure play-order logic for the music player.
 *
 * The queue is always the chat's music messages in ASCENDING order (oldest
 * first). A **play order** decides how the player walks that list:
 *
 * - `forward`   first → last, wrapping at the end (default)
 * - `backward`  last → first, wrapping at the start
 * - `shuffle`   a random "bag": a permutation of every queue index, consumed
 *               in order, with a play-history stack for `previous()`
 *
 * Nothing here touches React, the audio player or storage: every function is
 * deterministic apart from the injected `random` source, so the navigation
 * rules can be unit-tested.
 */

export type MusicPlayOrder = 'forward' | 'backward' | 'shuffle';

/** Cycle order used by the selector and the mini-bar mode button. */
export const MUSIC_PLAY_ORDERS: readonly MusicPlayOrder[] = [
    'forward',
    'backward',
    'shuffle',
];

/** Shuffle keeps this many previously played tracks for `previous()`. */
export const SHUFFLE_HISTORY_LIMIT = 50;

export type RandomSource = () => number;

export interface ShuffleCursor {
    /** Unplayed queue indexes of the current round; the head is next. */
    bag: number[];
    /** Played indexes, oldest first (capped at SHUFFLE_HISTORY_LIMIT). */
    history: number[];
    /** Position of the playing track inside `history`. */
    cursor: number;
}

export interface MusicQueueCursor {
    mode: MusicPlayOrder;
    /** Queue length this cursor was built for. */
    length: number;
    shuffle: ShuffleCursor;
}

/** Result of a navigation step: the track to play and the new cursor. */
export interface QueueStep {
    index: number;
    cursor: MusicQueueCursor;
}

function identityCursor(
    mode: MusicPlayOrder,
    length: number,
): MusicQueueCursor {
    return {
        mode,
        length,
        shuffle: { bag: [], history: [], cursor: -1 },
    };
}

/** Fisher–Yates permutation of `0..length-1`, optionally forcing `first`. */
export function shuffleBag(
    length: number,
    first: number,
    random: RandomSource = Math.random,
): number[] {
    const size = Math.max(0, Math.floor(length));
    const values: number[] = [];
    for (let index = 0; index < size; index += 1) {
        if (index !== first) values.push(index);
    }
    for (let index = values.length - 1; index > 0; index -= 1) {
        const swap = Math.min(
            index,
            Math.max(0, Math.floor(random() * (index + 1))),
        );
        const held = values[index] ?? 0;
        values[index] = values[swap] ?? 0;
        values[swap] = held;
    }
    if (first >= 0 && first < size) values.unshift(first);
    return values;
}

/**
 * The play order `mode` defines for a queue of `length` tracks.
 * `forward`/`backward` are the list and its reverse; `shuffle` is a fresh
 * random round (use `shuffleBag(length, current)` to pin the current track
 * first).
 */
export function buildQueueOrder(
    length: number,
    mode: MusicPlayOrder,
    random: RandomSource = Math.random,
): number[] {
    const size = Math.max(0, Math.floor(length));
    if (mode === 'shuffle') return shuffleBag(size, -1, random);
    const order: number[] = [];
    for (let index = 0; index < size; index += 1) {
        order.push(mode === 'backward' ? size - 1 - index : index);
    }
    return order;
}

/**
 * Builds the consumed part of a shuffle round: the current track is first,
 * the bag holds the remaining indexes in random order.
 */
export function startShuffleRound(
    length: number,
    current: number,
    random: RandomSource = Math.random,
): ShuffleCursor {
    const size = Math.max(0, Math.floor(length));
    if (size === 0 || current < 0 || current >= size) {
        return { bag: [], history: [], cursor: -1 };
    }
    const order = shuffleBag(size, current, random);
    return { bag: order.slice(1), history: [current], cursor: 0 };
}

/**
 * Cursor for starting to play `current` in `mode`.
 * Switching to shuffle mid-playback rebuilds the bag with the current track
 * first; forward/backward need no extra state (the list index is the position).
 */
export function createQueueCursor(
    length: number,
    current: number,
    mode: MusicPlayOrder,
    random: RandomSource = Math.random,
): MusicQueueCursor {
    if (mode !== 'shuffle') return identityCursor(mode, length);
    return {
        mode,
        length,
        shuffle: startShuffleRound(length, current, random),
    };
}

function clampIndex(index: number, length: number): number {
    if (length <= 0) return -1;
    if (index < 0) return 0;
    return index >= length ? length - 1 : index;
}

/**
 * Next track in the current order. Always wraps — playback never stops at the
 * end of the list:
 *
 * - forward  → the following message, first after the last
 * - backward → the preceding message, last after the first
 * - shuffle  → forward through the history when the user went back, otherwise
 *              the next item of the bag; an exhausted bag starts a new round
 *              whose first track is never the one that just played.
 */
export function nextIndex(
    cursor: MusicQueueCursor,
    current: number,
    length: number,
    random: RandomSource = Math.random,
): QueueStep {
    const size = Math.max(0, Math.floor(length));
    if (size === 0)
        return { index: -1, cursor: identityCursor(cursor.mode, 0) };

    const position = clampIndex(current, size);
    if (cursor.mode === 'forward') {
        return { index: (position + 1) % size, cursor };
    }
    if (cursor.mode === 'backward') {
        return { index: (position - 1 + size) % size, cursor };
    }

    const shuffle = cursor.shuffle;
    if (shuffle.cursor >= 0 && shuffle.cursor < shuffle.history.length - 1) {
        // The user stepped back into history: walk forward through it before
        // touching the bag again.
        const nextCursor = shuffle.cursor + 1;
        const index = shuffle.history[nextCursor];
        if (index !== undefined && index < size) {
            return {
                index,
                cursor: {
                    ...cursor,
                    shuffle: { ...shuffle, cursor: nextCursor },
                },
            };
        }
    }

    let bag = shuffle.bag.filter((index) => index < size);
    if (bag.length === 0) {
        // New round: every other track once, never starting with the one that
        // just finished (a single-track queue repeats that track).
        if (size === 1) {
            bag = [0];
        } else {
            bag = shuffleBag(size, -1, random).filter(
                (index) => index !== position,
            );
        }
    }
    const index = bag[0] ?? position;
    const remaining = bag.slice(1);
    const history = [...shuffle.history, index].slice(-SHUFFLE_HISTORY_LIMIT);
    return {
        index,
        cursor: {
            ...cursor,
            shuffle: {
                bag: remaining,
                history,
                cursor: history.length - 1,
            },
        },
    };
}

/**
 * Previous track in the current order (the store restarts the current track
 * instead when it has played for more than ~3 s):
 *
 * - forward  → the preceding message, the last one after the first
 * - backward → the following message, the first one after the last
 * - shuffle  → the previously played track from the history stack; at the
 *              start of the history it stays on the current track (restart).
 */
export function previousIndex(
    cursor: MusicQueueCursor,
    current: number,
    length: number,
): QueueStep {
    const size = Math.max(0, Math.floor(length));
    if (size === 0)
        return { index: -1, cursor: identityCursor(cursor.mode, 0) };

    const position = clampIndex(current, size);
    if (cursor.mode === 'forward') {
        return { index: (position - 1 + size) % size, cursor };
    }
    if (cursor.mode === 'backward') {
        return { index: (position + 1) % size, cursor };
    }

    const shuffle = cursor.shuffle;
    if (shuffle.cursor > 0) {
        const back = shuffle.cursor - 1;
        const index = shuffle.history[back];
        if (index !== undefined && index < size) {
            return {
                index,
                cursor: {
                    ...cursor,
                    shuffle: { ...shuffle, cursor: back },
                },
            };
        }
    }
    return { index: position, cursor };
}

/**
 * Remaps a cursor after the live queue changed (new music messages appended,
 * deleted ones removed) without touching the current track:
 *
 * - `indexMap[oldIndex]` is the index the old track has now, or null if it was
 *   deleted;
 * - appended tracks are inserted into the shuffle bag at random positions;
 * - `current` is the playing track's index in the NEW queue, so the history
 *   cursor keeps pointing at it.
 */
export function syncQueueCursor(
    cursor: MusicQueueCursor,
    indexMap: readonly (number | null)[],
    length: number,
    current: number,
    random: RandomSource = Math.random,
): MusicQueueCursor {
    const size = Math.max(0, Math.floor(length));
    if (cursor.mode !== 'shuffle') return { ...cursor, length: size };

    const map = (index: number): number | null => {
        const mapped = indexMap[index];
        return mapped === undefined || mapped === null || mapped >= size
            ? null
            : mapped;
    };

    const seen = new Set<number>();
    const history: number[] = [];
    for (const index of cursor.shuffle.history) {
        const mapped = map(index);
        if (mapped === null || seen.has(mapped)) continue;
        history.push(mapped);
        seen.add(mapped);
    }

    const bag: number[] = [];
    for (const index of cursor.shuffle.bag) {
        const mapped = map(index);
        if (mapped === null || seen.has(mapped) || bag.includes(mapped)) {
            continue;
        }
        bag.push(mapped);
    }

    // Tracks appended while playing join the round at random positions.
    for (let index = 0; index < size; index += 1) {
        if (seen.has(index) || bag.includes(index)) continue;
        const at = Math.min(
            bag.length,
            Math.max(0, Math.floor(random() * (bag.length + 1))),
        );
        bag.splice(at, 0, index);
    }

    const target = current >= 0 && current < size ? current : history.at(-1);
    if (target === undefined) {
        return {
            mode: 'shuffle',
            length: size,
            shuffle: { bag, history: [], cursor: -1 },
        };
    }
    let historyCursor = history.lastIndexOf(target);
    if (historyCursor < 0) {
        history.push(target);
        historyCursor = history.length - 1;
    }
    return {
        mode: 'shuffle',
        length: size,
        shuffle: { bag, history, cursor: historyCursor },
    };
}

/** Small helper shared by the store: the queue index that follows `current`. */
export function peekNextIndex(
    cursor: MusicQueueCursor,
    current: number,
    length: number,
    random: RandomSource = Math.random,
): number {
    return nextIndex(cursor, current, length, random).index;
}
