import { getSocket, request, type AppSocket } from '../../core/socket';
import { ApiError } from '../../core/api';
import type { ChatDto, MessageDto, MessagePageDto } from '../../core/api';
import { markChatRoomJoined } from './active-room';

/**
 * WebSocket-based API for chats (docs/mobile-api/websocket-contract.md).
 *
 * Every request is one `request()` call over the shared authenticated socket;
 * acks are the single completion signal (`{ ok: true, data }` from the backend).
 */

const NOT_CONNECTED_MESSAGE = 'Not connected — sign in again.';

/** Page size the app asks for when loading older history. */
export const MESSAGES_PAGE_SIZE = 30;

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
 * WS `getMessages` → one page of history, newest first.
 *
 * No `beforeId` = the latest page (also what old clients send). `nextCursor` is
 * the id of the oldest message in the page, or null for an empty page.
 */
export function fetchChatMessages(
    chatId: number,
    beforeId?: number,
    limit?: number,
): Promise<MessagePageDto | null> {
    const payload: { chatId: number; beforeId?: number; limit?: number } = {
        chatId,
    };
    if (beforeId !== undefined) {
        payload.beforeId = beforeId;
    }
    if (limit !== undefined) {
        payload.limit = limit;
    }
    return request<MessagePageDto>(socketOrThrow(), 'getMessages', payload);
}

/** One `joinChat` ack (chat info) plus the first history page. */
export interface CurrentChatInfo {
    info: ChatDto | null;
    messages: MessageDto[];
    hasMore: boolean;
    nextCursor: number | null;
}

/**
 * WS `joinChat` ({ chatId }) → joins the chat room and fetches the first page
 * of history. The chat info is the join ack. Re-joining the same chat is
 * idempotent server-side (ack again, no hang).
 */
export async function joinChat(
    chatId: number,
): Promise<CurrentChatInfo | null> {
    const info = await request<ChatDto>(socketOrThrow(), 'joinChat', {
        chatId,
    });
    // The server has left the previous room and joined this one. Record it so
    // focus/blur handling knows which room the socket currently owns.
    markChatRoomJoined(chatId);
    const page = await fetchChatMessages(chatId);
    return {
        info,
        messages: page?.messages ?? [],
        hasMore: page?.hasMore ?? false,
        nextCursor: page?.nextCursor ?? null,
    };
}
