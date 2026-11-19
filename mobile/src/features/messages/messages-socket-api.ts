import { request } from '../../core/socket';
import type {
    CreateMessageSocketPayload,
    EditMessageSocketPayload,
    DeleteMessageSocketPayload,
    MarkSeenSocketPayload,
    ForwardMessagesSocketPayload,
    ForwardMessagesResult,
    ReactMessageSocketPayload,
    MessageReactionsSocketPayload,
    PinMessageSocketPayload,
} from '../../core/socket';
import { socketOrThrow } from '../chats/chats-socket-api';
import { ApiError } from '../../core/api';
import type {
    MessageDto,
    MessageReactionsDto,
    ReactionSnapshotDto,
} from '../../core/api';

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
    replyToId?: number,
    attachmentIds?: number[],
    clientMessageId?: string,
    type?: 'text' | 'music',
): Promise<MessageDto | null> {
    const payload: CreateMessageSocketPayload = { chatId, content };
    if (type !== undefined) {
        payload.type = type;
    }
    if (replyToId !== undefined) {
        payload.reply = replyToId;
    }
    if (attachmentIds !== undefined && attachmentIds.length > 0) {
        payload.attachments = attachmentIds;
    }
    if (clientMessageId !== undefined) {
        payload.clientMessageId = clientMessageId;
    }
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

/** WS `markSeen` — monotonic read position; resolves the effective id. */
export async function markChatSeen(
    chatId: number,
    lastSeenId: number,
): Promise<{ lastSeenId: number } | null> {
    const payload: MarkSeenSocketPayload = { chatId, lastSeenId };
    return request<{ lastSeenId: number }>(
        connectedSocket(),
        'markSeen',
        payload,
    );
}

/** WS `forwardMessages` — copies 1..20 messages to 1..5 authorized chats. */
export async function forwardChatMessages(
    payload: ForwardMessagesSocketPayload,
): Promise<ForwardMessagesResult | null> {
    return request<ForwardMessagesResult>(
        connectedSocket(),
        'forwardMessages',
        payload,
    );
}

/** WS `deleteMessage` — soft delete of own messages. */
export async function deleteChatMessage(
    messageId: number,
    chatId: number,
): Promise<unknown> {
    const payload: DeleteMessageSocketPayload = { messageId, chatId };
    return request(connectedSocket(), 'deleteMessage', payload);
}

/** Ack of `pinMessage`: the serialized pinned message + idempotency flag. */
export interface PinMessageResult {
    message: MessageDto;
    alreadyPinned: boolean;
}

/** WS `pinMessage` — idempotent; repeats return `alreadyPinned: true`. */
export async function pinChatMessage(
    chatId: number,
    messageId: number,
): Promise<PinMessageResult | null> {
    const payload: PinMessageSocketPayload = { chatId, messageId };
    return request<PinMessageResult>(connectedSocket(), 'pinMessage', payload);
}

/** WS `unpinMessage` — idempotent; repeats return `alreadyUnpinned: true`. */
export async function unpinChatMessage(
    chatId: number,
    messageId: number,
): Promise<{ messageId: number; alreadyUnpinned: boolean } | null> {
    const payload: PinMessageSocketPayload = { chatId, messageId };
    return request(connectedSocket(), 'unpinMessage', payload);
}

/** WS `getPinnedMessages` — full pinned list, newest pin first (offline sync). */
export async function fetchPinnedMessages(
    chatId: number,
): Promise<MessageDto[] | null> {
    return request<MessageDto[]>(connectedSocket(), 'getPinnedMessages', {
        chatId,
    });
}

/** WS `reactMessage` — one reaction per user; null clears, same emoji toggles. */
export async function reactToMessage(
    chatId: number,
    messageId: number,
    emoji: string | null,
): Promise<ReactionSnapshotDto | null> {
    const payload: ReactMessageSocketPayload = { chatId, messageId, emoji };
    return request<ReactionSnapshotDto>(
        connectedSocket(),
        'reactMessage',
        payload,
    );
}

/** WS `getMessageReactions` — grouped reactor list, max 100 users. */
export async function fetchMessageReactions(
    chatId: number,
    messageId: number,
): Promise<MessageReactionsDto | null> {
    const payload: MessageReactionsSocketPayload = { chatId, messageId };
    return request<MessageReactionsDto>(
        connectedSocket(),
        'getMessageReactions',
        payload,
    );
}
