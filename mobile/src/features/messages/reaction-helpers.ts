import type { ReactionSnapshotDto } from '../../core/api';
import { normalizeEmoji } from '../reactions';
import type { ChatMessage, MessageReaction } from './messages-model';
import { toNumericId } from './messages-model';

/**
 * Chat-cache reaction mutations. The cache stays immutable; every helper
 * returns a new list and changes only the matching message.
 */

/** Count desc, preserving the server/catalog order for equal counts. */
export function sortReactions(
    reactions: readonly MessageReaction[],
): MessageReaction[] {
    return reactions
        .map((reaction, index) => ({ reaction, index }))
        .sort(
            (left, right) =>
                right.reaction.count - left.reaction.count ||
                left.index - right.index,
        )
        .map(({ reaction }) => ({ ...reaction }));
}

/** Drops malformed rows and merges duplicate emojis emitted by a bad peer. */
function normalizeReactionRows(
    reactions: ReactionSnapshotDto['reactions'],
): MessageReaction[] {
    const byKey = new Map<string, MessageReaction>();
    for (const row of reactions) {
        if (typeof row?.emoji !== 'string' || row.emoji.trim() === '') {
            continue;
        }
        const count = Number(row.count);
        if (!Number.isFinite(count) || count <= 0) {
            continue;
        }
        const key = normalizeEmoji(row.emoji);
        const existing = byKey.get(key);
        if (existing === undefined) {
            byKey.set(key, { emoji: row.emoji, count });
        } else {
            existing.count += count;
        }
    }
    return sortReactions([...byKey.values()]);
}

/**
 * Applies a `reaction:updated` snapshot. Counts come from the event; the
 * viewer's own emoji prefers the personalized field and falls back to the
 * actor when the viewer is the actor (older servers).
 */
export function applyReactionUpdate(
    current: ChatMessage[],
    event: ReactionSnapshotDto,
    myUserId: number | null,
): ChatMessage[] {
    if (!Array.isArray(event?.reactions)) {
        return current;
    }
    const messageId = toNumericId(event.messageId);
    if (messageId === null) {
        return current;
    }
    const me = toNumericId(myUserId);
    const actorId = toNumericId(event.actor?.userId);
    const personalized =
        event.myReaction !== undefined
            ? event.myReaction
            : me !== null && actorId === me
              ? (event.actor?.emoji ?? null)
              : undefined;

    return current.map((message) => {
        if (message.id !== messageId) {
            return message;
        }
        return {
            ...message,
            reactions: normalizeReactionRows(event.reactions),
            myReaction:
                personalized === undefined ? message.myReaction : personalized,
            myReactionProvided:
                message.myReactionProvided || personalized !== undefined,
        };
    });
}

/**
 * Optimistic one-reaction-per-user toggle. Passing the emoji the user already
 * has removes it; a different emoji replaces it.
 */
export function applyMyReaction(
    current: ChatMessage[],
    messageId: number,
    emoji: string | null,
): ChatMessage[] {
    return current.map((message) => {
        if (message.id !== messageId) {
            return message;
        }
        const previous = message.myReaction;
        const previousKey = previous === null ? null : normalizeEmoji(previous);
        const requestedKey = emoji === null ? null : normalizeEmoji(emoji);
        const nextEmoji =
            requestedKey !== null && requestedKey === previousKey
                ? null
                : emoji;

        const counts: MessageReaction[] = message.reactions.map((reaction) => ({
            ...reaction,
        }));
        if (previous !== null) {
            const old = counts.find(
                (reaction) => normalizeEmoji(reaction.emoji) === previousKey,
            );
            if (old !== undefined) {
                old.count -= 1;
                if (old.count <= 0) {
                    counts.splice(counts.indexOf(old), 1);
                }
            }
        }
        if (nextEmoji !== null && nextEmoji.trim() !== '') {
            const key = normalizeEmoji(nextEmoji);
            const existing = counts.find(
                (reaction) => normalizeEmoji(reaction.emoji) === key,
            );
            if (existing === undefined) {
                counts.push({ emoji: nextEmoji, count: 1 });
            } else {
                existing.count += 1;
            }
        }

        return {
            ...message,
            reactions: sortReactions(counts),
            myReaction: nextEmoji,
            myReactionProvided: true,
        };
    });
}
