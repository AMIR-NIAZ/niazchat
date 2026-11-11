import { onSocketDisconnect } from '../../core/socket';

/**
 * Which chat room the ONE shared socket is believed to be in, and which chat
 * screen currently has focus.
 *
 * The backend keeps exactly one active chat per socket: `joinChat` leaves the
 * previous room and `leaveChat` (or a disconnect) ends the membership. React
 * Navigation keeps the previous chat screen mounted when another screen is
 * pushed on top (profile, group info, forwarded-to chat, the same chat opened
 * again from a profile), so "mounted" is NOT "joined": the room must follow
 * FOCUS, not mount/unmount. Without that, the screen the user returns to is no
 * longer in `chat:<id>` and silently stops receiving `sendMessage:list`,
 * `seen`/typing broadcasts, so it can never send a read receipt for messages
 * it never saw, and the sender's Seen tick only appears once another message
 * (a `markSeen` from the newly received id) moves the position forward.
 *
 * Room memberships live server-side and are lost with the connection, so the
 * marker is cleared on every socket disconnect; the reconnect path re-joins the
 * focused chat and `ensureActive` re-joins after any blur.
 */
let activeRoomChatId: number | null = null;
let focusedChatId: number | null = null;

/** The socket room name the backend uses for a chat. */
export function chatRoomName(chatId: number): string {
    return `chat:${chatId}`;
}

/** Record a confirmed `joinChat` ack (this is the socket's active room now). */
export function markChatRoomJoined(chatId: number): void {
    activeRoomChatId = chatId;
}

/**
 * Forget the active room when this chat is the one being left. Returns true
 * when the marker matched (the caller should emit `leaveChat`); a late blur or
 * unmount of an underlying screen must never leave the chat on top.
 */
export function clearChatRoom(chatId: number): boolean {
    if (activeRoomChatId !== chatId) {
        return false;
    }
    activeRoomChatId = null;
    return true;
}

export function getActiveRoomChatId(): number | null {
    return activeRoomChatId;
}

/** The chat screen that currently has navigation focus (only one at a time). */
export function markChatFocused(chatId: number): void {
    focusedChatId = chatId;
}

export function markChatBlurred(chatId: number): void {
    if (focusedChatId === chatId) {
        focusedChatId = null;
    }
}

export function getFocusedChatId(): number | null {
    return focusedChatId;
}

/** Rooms are per-connection: after a disconnect nothing is joined any more. */
export function resetChatRoomState(): void {
    activeRoomChatId = null;
    focusedChatId = null;
}

onSocketDisconnect((): void => {
    activeRoomChatId = null;
});

/**
 * Whether a focused chat screen must re-join its room before it can trust live
 * events again. The very first focus is skipped by the caller (the
 * conversation query's initial `joinChat` already performs that join, avoiding
 * a duplicate `joinChat` + `getMessages` on open). A load in flight or a sync
 * already running also skips, so repeated focus events never stack joins.
 *
 * `syncRequired` forces a re-sync after a blur even when the marker still
 * names this chat (another screen may have joined it, e.g. group info), so a
 * message that arrived during the blur is never left out of the open list.
 */
export function needsChatRoomJoin(input: {
    chatId: number | null;
    activeRoomChatId: number | null;
    initialJoinPending: boolean;
    loading: boolean;
    syncing: boolean;
    syncRequired?: boolean;
}): boolean {
    if (
        input.chatId === null ||
        !Number.isInteger(input.chatId) ||
        input.chatId <= 0
    ) {
        return false;
    }
    if (input.initialJoinPending || input.loading || input.syncing) {
        return false;
    }
    return (
        input.syncRequired === true ||
        input.activeRoomChatId !== input.chatId
    );
}
