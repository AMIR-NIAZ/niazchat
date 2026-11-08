import { dayKeyOf, isOwnMessage } from './messages-model';
import type { ChatMessage } from './messages-model';

/**
 * Telegram-style sender runs, computed from the merged list at render time
 * (never stored in the cache, so pagination, live messages, edits and deletes
 * all recombine automatically).
 *
 * A run is a maximal block of consecutive messages from the SAME sender with
 * nothing between them: no day separator, no unread divider, no other sender.
 * - the sender name is shown on the FIRST message of the run;
 * - the avatar is shown on the LAST message of the run (bottom aligned).
 *
 * Private chats and my own messages never show either.
 */
export interface MessageRunInfo {
    message: ChatMessage;
    /** A day separator must be rendered before this message. */
    startsNewDay: boolean;
    showSenderName: boolean;
    showAvatar: boolean;
}

export interface MessageRunOptions {
    isGroup: boolean;
    currentUserId: number | null;
    /** Id of the message that has the unread divider right before it. */
    dividerMessageId?: number | null;
}

function isSameSender(previous: ChatMessage, next: ChatMessage): boolean {
    return (
        previous.senderId === next.senderId &&
        previous.status === 'sent' &&
        next.status === 'sent'
    );
}

export function assignMessageRuns(
    messages: ChatMessage[],
    options: MessageRunOptions,
): MessageRunInfo[] {
    const { isGroup, currentUserId, dividerMessageId = null } = options;

    /** True when a new run must start at `next` (given its predecessor). */
    const breaksBefore = (
        previous: ChatMessage | null,
        next: ChatMessage,
    ): boolean => {
        if (previous === null) {
            return true;
        }
        if (dayKeyOf(previous.createdAtIso) !== dayKeyOf(next.createdAtIso)) {
            return true;
        }
        if (dividerMessageId !== null && next.id === dividerMessageId) {
            return true;
        }
        return !isSameSender(previous, next);
    };

    return messages.map((message, index) => {
        const previous = index > 0 ? (messages[index - 1] ?? null) : null;
        const next = messages[index + 1] ?? null;
        const runStart = breaksBefore(previous, message);
        const runEnd = next === null || breaksBefore(message, next);
        const mine = isOwnMessage(currentUserId, message.senderId);
        // Optimistic (pending/failed) bubbles are local-only, own messages:
        // they never participate in another sender's run.
        const confirmed = message.status === 'sent';

        return {
            message,
            startsNewDay:
                previous !== null &&
                dayKeyOf(previous.createdAtIso) !==
                    dayKeyOf(message.createdAtIso),
            showSenderName: isGroup && !mine && confirmed && runStart,
            showAvatar: isGroup && !mine && confirmed && runEnd,
        };
    });
}
