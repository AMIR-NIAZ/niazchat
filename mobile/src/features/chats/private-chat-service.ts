import { ApiError, httpClient } from '../../core/api';
import type { PeerDto } from '../../core/api/dto/chat.dto';

/** `POST /chats/private` ack. `created` is false when the chat already existed. */
export interface CreatePrivateChatResponse {
    chatId: number;
    created: boolean;
    peer: PeerDto;
}

/**
 * Finds or creates the single chat of (caller, userId). Idempotent and
 * symmetric server-side; safe to call twice from either side.
 */
export async function createPrivateChat(
    userId: number,
): Promise<CreatePrivateChatResponse> {
    const response = await httpClient.post<CreatePrivateChatResponse>(
        '/chats/private',
        { userId },
    );
    const data = response.data;
    return {
        chatId: Number(data.chatId),
        created: data.created === true,
        peer: { ...data.peer, id: Number(data.peer.id) },
    };
}

/** User-safe messages for the "Message" / new-chat flows. */
export function describePrivateChatError(error: unknown): string {
    if (error instanceof ApiError) {
        switch (error.statusCode) {
            case 404:
                return 'This user is not available';
            case 429:
                return 'Too many requests, try again later';
            case 400:
                return error.message;
            case 401:
                return 'Session expired. Please sign in again.';
            case 0:
                return 'Network problem — could not reach the server.';
            default:
                return error.message;
        }
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Could not start this chat.';
}
