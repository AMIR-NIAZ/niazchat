import { Message } from 'src/modules/messages/entities/message.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { toUserResponse } from 'src/modules/auth/utils/user-response.util';

export const num = (value: unknown): number =>
    typeof value === 'number' ? value : Number(value);

/** Reply previews are compact: long originals are cut server-side. */
export const REPLY_PREVIEW_MAX_LENGTH = 200;

function truncateReplyContent(content: string | null | undefined): string {
    const text = content ?? '';
    return text.length <= REPLY_PREVIEW_MAX_LENGTH
        ? text
        : `${text.slice(0, REPLY_PREVIEW_MAX_LENGTH)}…`;
}

/**
 * Compact quoted-message preview (never the full entity). A soft-deleted
 * original keeps its id/flag but leaks no content.
 */
export function serializeReplyPreview(reply: Message | null | undefined) {
    if (reply === undefined || reply === null) {
        return null;
    }
    const isDeleted = reply.isDeleted === true;
    return {
        id: num(reply.id),
        content: isDeleted ? null : truncateReplyContent(reply.content),
        senderId: num(reply.sender?.id ?? 0),
        senderName: reply.sender?.profile?.name ?? '',
        type: reply.type?.name ?? 'text',
        attachmentsCount: reply.attachments?.length ?? 0,
        isDeleted,
    };
}

/**
 * Shared chat-list preview wire shape, used by BOTH `getAllChats` and the
 * `chatlist:updated` event so the app sees identical data from either source.
 */
export function serializeLastMessage(message: Message) {
    return {
        id: num(message.id),
        content: message.content ?? '',
        senderId: num(message.sender?.id ?? 0),
        createdAt: message.createdAt,
        attachments: (message.attachments ?? []).map((attachment) => ({
            id: num(attachment.id),
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            size: Number(attachment.size),
        })),
    };
}

/** Chat wire shape: numeric ids, no relations (lastMessage/members unloaded). */
export function serializeChat(chat: Chat & { unreadCount?: number }) {
    return {
        id: num(chat.id),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        title: chat.title ?? null,
        avatars: chat.avatars ?? [],
        type: chat.type,
        isBan: chat.isBan,
        // Authoritative only on `getAllChats`; live list updates increment
        // locally in the app and resync on focus/reconnect. `chatInfo` sends 0.
        unreadCount: chat.unreadCount ?? 0,
        // Same shape `notifyChatList` emits; null when no message yet / not loaded.
        lastMessage:
            chat.lastMessage === undefined || chat.lastMessage === null
                ? null
                : serializeLastMessage(chat.lastMessage),
    };
}

/**
 * Message wire shape: numeric ids, top-level `chatId`/`senderId`, the
 * serialized sender, the type row and the attachments. No `chat` object.
 */
export function serializeMessage(message: Message) {
    const senderResponse = message.sender
        ? (toUserResponse(message.sender) as Record<string, unknown>)
        : null;
    const sender = senderResponse
        ? { ...senderResponse, id: num(message.sender.id) }
        : null;

    return {
        id: num(message.id),
        content: message.content ?? null,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        isEdited: message.isEdited,
        isDeleted: message.isDeleted,
        chatId: num(message.chat?.id ?? 0),
        senderId: num(message.sender?.id ?? 0),
        sender,
        replyToId:
            message.replyTo !== undefined && message.replyTo !== null
                ? num(message.replyTo.id)
                : null,
        replyTo: serializeReplyPreview(message.replyTo),
        typeId: message.type?.id ? num(message.type.id) : null,
        type: message.type
            ? { id: num(message.type.id), name: message.type.name }
            : null,
        attachments: (message.attachments ?? []).map((attachment) => ({
            id: num(attachment.id),
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            size: Number(attachment.size),
            createdAt: attachment.createdAt,
        })),
    };
}
