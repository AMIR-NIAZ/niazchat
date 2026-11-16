import { router } from 'expo-router';

/**
 * "Go to message" for the full player: the player lives outside the chat
 * screen, so it asks the mounted chat to scroll to the track's message, and
 * when that chat is not open it navigates there first and leaves a pending
 * request the chat consumes on mount.
 */

type JumpHandler = (messageKey: string) => void;

const handlers = new Map<number, JumpHandler>();
let pending: { chatId: number; messageKey: string } | null = null;

/** Registered by the chat screen while it is mounted. */
export function registerMusicJumpHandler(
    chatId: number,
    handler: JumpHandler,
): () => void {
    handlers.set(chatId, handler);
    return (): void => {
        if (handlers.get(chatId) === handler) handlers.delete(chatId);
    };
}

/** Reads (and clears) a request left by the player for this chat. */
export function consumeMusicJumpRequest(chatId: number): string | null {
    if (pending === null || pending.chatId !== chatId) return null;
    const messageKey = pending.messageKey;
    pending = null;
    return messageKey;
}

/** Scrolls to the track's message, opening its chat when necessary. */
export function goToMusicMessage(chatId: number, messageKey: string): void {
    const handler = handlers.get(chatId);
    if (handler !== undefined) {
        handler(messageKey);
        return;
    }
    pending = { chatId, messageKey };
    router.push(`/(app)/chat/${chatId}`);
}
