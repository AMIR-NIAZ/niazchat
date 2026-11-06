import { request } from '../../core/socket';
import type {
    CreateMessageSocketPayload,
    EditMessageSocketPayload,
    DeleteMessageSocketPayload,
} from '../../core/socket';
import { socketOrThrow } from '../chats/chats-socket-api';
import { ApiError } from '../../core/api';
import type { MessageDto } from '../../core/api';

/** WebSocket API for messaging (docs/mobile-api/websocket-contract.md).
 *
 * Every call is a single acked `request()`: success resolves fast with the ack
 * data (the sender's own `sendMessage:list` echo — or, when it is not in the
 * room, the direct echo — replaces the optimistic bubble), failure rejects on
 * the ack error.
 *
 * While the socket is reconnecting, socket.io would silently buffer the emit
 * and deliver it whenever the connection comes back, so the bubble could stay
 * pending for an unbounded time. Reject instead so the UI can retry.
 */

const CONNECTION_LOST_MESSAGE =
    'Connection lost, reconnecting. Try again in a moment.';

function connectedSocket(): ReturnType<typeof socketOrThrow> {
    const socket = socketOrThrow();
    if (!socket.connected) {
        throw new ApiError({
            success: false,
            statusCode: 0,
            message: CONNECTION_LOST_MESSAGE,
        });
    }
    return socket;
}

export async function deliverMessage(
    chatId: number,
    content: string,
): Promise<MessageDto | null> {
    const payload: CreateMessageSocketPayload = { chatId, content };
    return request<MessageDto>(connectedSocket(), 'sendMessage', payload);
}

/** WS `editMessage` — own text messages only. */
export async function editChatMessage(
    messageId: number,
    chatId: number,
    newContent: string,
): Promise<MessageDto | null> {
    const payload: EditMessageSocketPayload = { messageId, chatId, newContent };
    return request<MessageDto>(connectedSocket(), 'editMessage', payload);
}

/** WS `deleteMessage` — soft delete of own messages. */
export async function deleteChatMessage(
    messageId: number,
    chatId: number,
): Promise<unknown> {
    const payload: DeleteMessageSocketPayload = { messageId, chatId };
    return request(connectedSocket(), 'deleteMessage', payload);
}
