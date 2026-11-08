/**
 * The chat currently on screen, plus whether the user is actually looking at
 * the newest message (screen focused + app active + list near the bottom).
 * The chat list reads this at event time to decide whether an incoming
 * `chatlist:updated` may increment the local unread estimate.
 */
let activeChatId: number | null = null;
let reading = false;

export function setActiveChat(chatId: number | null, isReading: boolean): void {
    activeChatId = chatId;
    reading = isReading;
}

export function getActiveChat(): { chatId: number | null; reading: boolean } {
    return { chatId: activeChatId, reading };
}
