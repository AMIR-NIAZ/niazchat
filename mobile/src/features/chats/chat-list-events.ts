import type { ChatPreview } from './chats-model';

/**
 * Pure cache transforms for the private-chat lifecycle events. Kept separate
 * from `use-chats` so the real-time rules are unit-testable without React.
 *
 * Backend contract (`chats.gateway.ts`):
 * - `chat:blocked`  → caller's devices only; carries both block directions.
 * - `chat:removed`  → caller's devices only ("delete for me"); the peer is
 *   never notified.
 * - `chat:deleted`  → BOTH participants' personal rooms ("delete for both").
 */

export interface ChatBlockedEvent {
    chatId: number;
    blockedByMe: boolean;
    blockedMe: boolean;
    blocked?: boolean;
}

/**
 * Patch the caller's directional block flags on one private row. A chat that
 * is not in the cached list is left alone (it will arrive with the next
 * `getAllChats`), and an unchanged state returns the SAME array so React
 * Query does not republish the list.
 */
export function applyChatBlockedEvent(
    chats: readonly ChatPreview[],
    event: ChatBlockedEvent,
): readonly ChatPreview[] {
    const chatId = Number(event.chatId);
    const target = chats.find((chat) => Number(chat.id) === chatId);
    if (target === undefined) {
        return chats;
    }
    const blockedByMe = event.blockedByMe === true;
    const blockedMe = event.blockedMe === true;
    if (
        (target.blockedByMe ?? false) === blockedByMe &&
        (target.blockedMe ?? false) === blockedMe
    ) {
        return chats;
    }
    return chats.map((chat) =>
        Number(chat.id) === chatId ? { ...chat, blockedByMe, blockedMe } : chat,
    );
}

/**
 * Drop one row after a delete (for me or for both). Returns the SAME array
 * when the row is absent, so duplicate events are harmless.
 */
export function removeChatFromList(
    chats: readonly ChatPreview[],
    chatId: number,
): readonly ChatPreview[] {
    const target = Number(chatId);
    if (!chats.some((chat) => Number(chat.id) === target)) {
        return chats;
    }
    return chats.filter((chat) => Number(chat.id) !== target);
}
