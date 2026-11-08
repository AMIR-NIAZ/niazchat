/**
 * Message DTOs (docs/mobile-api/messages.md).
 */
import type { ChatLastMessageDto } from './chat.dto';
import type { UserDto } from './user.dto';

export type MessageTypeName =
    | 'text'
    | 'image'
    | 'video'
    | 'file'
    | 'voice'
    | 'ice';

/**
 * Serialized `Message` entity from WS `getMessages` / `sendMessage:list` / `editMessage:list`.
 * `type` is a `type_messages` catalog row — use `.name`, never the raw `typeId`.
 */
/** Compact quoted preview carried on a reply (server truncates content). */
export interface MessageReplyDto {
    id: number;
    /** Null when the original was soft-deleted (no content leaked). */
    content: string | null;
    senderId: number;
    senderName: string;
    type: MessageTypeName;
    attachmentsCount: number;
    isDeleted: boolean;
}

export interface MessageDto {
    id: number;
    /** Empty/null for attachment-only messages. */
    content: string | null;
    createdAt: string;
    updatedAt: string;
    isEdited: boolean;
    isDeleted: boolean;
    /** Raw FK, not the enum string. */
    typeId: number;
    type: {
        id: number;
        name: MessageTypeName;
        createdAt: string;
        updatedAt: string;
    };
    chatId: number;
    senderId: number;
    sender: UserDto;
    replyToId: number | null;
    /** Compact preview of the replied-to message; null when this is not a reply. */
    replyTo: MessageReplyDto | null;
    attachments: MessageAttachmentDto[];
}

/**
 * WS `getMessages` ack data: one page of history, newest first.
 * `nextCursor` is the id of the OLDEST message in the page (null when empty).
 */
export interface MessagePageDto {
    messages: MessageDto[];
    hasMore: boolean;
    nextCursor: number | null;
}

/** Narrowed attachment projection inside message payloads. */
export interface MessageAttachmentDto {
    id: number;
    originalName: string;
    mimeType: string;
    size: number;
    createdAt: string;
}

/** WS `chatlist:updated` payload (preview updates to each member's user room). */
export interface ChatListUpdateDto {
    chatId: number;
    /** Null when the chat's last message was just deleted by anyone. */
    lastMessage: ChatLastMessageDto | null;
}

/** `sendMessage` client → server payload (`CreateMessageDto`). */
export interface CreateMessagePayloadDto {
    /** Required for group chats. */
    chatId?: number;
    /** Required for private messages (receiver user id; backend implicitly creates the PV chat). */
    userId?: number;
    /** Required for text messages; max 5000 chars. */
    content?: string;
    /** MessageId being replied to. */
    reply?: number;
    /** 1..10 attachment ids; they must belong to the same chat and be unused. */
    attachments?: number[];
    /** Defaults to `text` server-side. */
    type?: MessageTypeName;
}

/** `editMessage` client → server payload (`EditMessageDto`). */
export interface EditMessagePayloadDto {
    messageId: number;
    chatId: number;
    /** Max 5000 chars; own text-type messages only. */
    newContent: string;
}

/** `deleteMessage` client → server payload (`deleteMessageDto`). */
export interface DeleteMessagePayloadDto {
    messageId: number;
    chatId: number;
}
