import { getSocket, request, type AppSocket } from '../../core/socket';
import { ApiError } from '../../core/api';
import type { ChatDto, MessageDto } from '../../core/api';

/**
 * WebSocket-based API for chats (docs/mobile-api/websocket-contract.md).
 *
 * Every request is one `request()` call over the shared authenticated socket;
 * acks are the single completion signal (`{ ok: true, data }` from the backend).
 */

const NOT_CONNECTED_MESSAGE = 'Not connected — sign in again.';

export function socketOrThrow(): AppSocket {
    const socket = getSocket();
    if (socket === null) {
        throw new ApiError({
            success: false,
            statusCode: 0,
            message: NOT_CONNECTED_MESSAGE,
        });
    }
    return socket;
}

/** WS `getAllChats` → serialized `Chat` rows (no lastMessage/members loaded). */
export function fetchChats(): Promise<ChatDto[] | null> {
    return request<ChatDto[]>(socketOrThrow(), 'getAllChats');
}

/**
 * WS `joinChat` ({ chatId }) → joins the chat room; the ack data is the chat
 * info. Re-joining the same chat is idempotent server-side (ack again, no hang).
 */
export function joinChat(chatId: number): Promise<ChatDto | null> {
    return request<ChatDto>(socketOrThrow(), 'joinChat', { chatId });
}

/** WS `getMessages` ({ chatId }) → history (last 50, DESC or []; works for empty chats). */
export function fetchChatMessages(
    chatId: number,
): Promise<MessageDto[] | null> {
    return request<MessageDto[]>(socketOrThrow(), 'getMessages', { chatId });
}
