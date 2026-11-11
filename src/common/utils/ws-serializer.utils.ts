import { Message } from 'src/modules/messages/entities/message.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { UserProfile } from 'src/modules/auth/entities/user_profile.entity';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { attachmentKindOf } from './attachment-kind.util';
import type { MessageReactionSummary } from 'src/modules/reactions/reaction.types';

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
 * Attachment wire metadata shared by message payloads and chat-list previews.
 * `posterPath` never leaves the server; the app only needs `hasPoster`.
 */
function serializeAttachmentMeta(attachment: {
    id: unknown;
    originalName: string;
    mimeType: string;
    size: unknown;
    width?: number | null;
    height?: number | null;
    duration?: string | number | null;
    posterPath?: string | null;
    voice?: boolean | null;
    waveform?: number[] | null;
    createdAt?: Date;
}) {
    const kind = attachmentKindOf(attachment.mimeType, attachment.voice);
    const width = attachment.width == null ? null : Number(attachment.width);
    const height = attachment.height == null ? null : Number(attachment.height);
    const duration =
        attachment.duration == null ? null : Number(attachment.duration);
    return {
        id: num(attachment.id),
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: Number(attachment.size),
        kind,
        ...(width !== null &&
        height !== null &&
        Number.isFinite(width) &&
        Number.isFinite(height)
            ? { width, height }
            : {}),
        ...(kind === 'video' || kind === 'voice'
            ? {
                  duration:
                      duration !== null && Number.isFinite(duration)
                          ? duration
                          : null,
              }
            : {}),
        ...(kind === 'video'
            ? { hasPoster: attachment.posterPath != null }
            : {}),
        ...(kind === 'voice'
            ? { waveform: normalizeWaveform(attachment.waveform) }
            : {}),
        ...(attachment.createdAt !== undefined
            ? { createdAt: attachment.createdAt }
            : {}),
    };
}

/** Wire waveform is exactly 64 integers 0..100, or null (flat bars). */
function normalizeWaveform(
    value: number[] | null | undefined,
): number[] | null {
    if (!Array.isArray(value) || value.length !== 64) {
        return null;
    }
    const bars = value.map((bar) => Number(bar));
    if (bars.some((bar) => !Number.isFinite(bar) || bar < 0 || bar > 100)) {
        return null;
    }
    return bars.map((bar) => Math.round(bar));
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
    const firstAttachment = reply.attachments?.[0];
    return {
        id: num(reply.id),
        content: isDeleted ? null : truncateReplyContent(reply.content),
        senderId: num(reply.sender?.id ?? 0),
        senderName: reply.sender?.profile?.name ?? '',
        type: reply.type?.name ?? 'text',
        attachmentsCount: reply.attachments?.length ?? 0,
        attachmentKind: isDeleted
            ? null
            : attachmentKindOf(
                  firstAttachment?.mimeType,
                  firstAttachment?.voice,
              ),
        attachmentDuration:
            !isDeleted &&
            firstAttachment?.duration != null &&
            Number.isFinite(Number(firstAttachment.duration))
                ? Number(firstAttachment.duration)
                : null,
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
        attachments: (message.attachments ?? []).map((attachment) =>
            serializeAttachmentMeta(attachment),
        ),
    };
}

/**
 * Chat wire shape: numeric ids, no relations (lastMessage/members unloaded).
 * Private chats always serialize `title: null`; groups keep their title.
 */
export function serializeChat(
    chat: Chat & {
        unreadCount?: number;
        peerName?: string | null;
        peer?: unknown;
    },
) {
    return {
        id: num(chat.id),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        title: chat.type === TypeChatEnum.PRIVATE ? null : (chat.title ?? null),
        description: chat.description ?? null,
        peerName: chat.peerName ?? null,
        peer: chat.peer ?? null,
        // Chat lists/headers render the CURRENT photo only. The full gallery
        // is exposed by `GET /chats/:chatId/group` and `group:updated`.
        avatars: (chat.avatars ?? []).slice(0, 1),
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
 * Minimal sender projection embedded in message payloads.
 *
 * Messages reach every member of a room; the full user response (phone,
 * lastSeen, status, biografy, role) is NOT needed to render a bubble and is
 * personal data, so only the identity/display fields are sent. `avatars` holds
 * at most the CURRENT photo (index 0 convention), keeping the array shape the
 * app already maps.
 */
function serializeMessageSender(message: Message) {
    const sender = message.sender as
        | (User & {
              name?: string;
              username?: string | null;
              avatars?: string[] | null;
              profile?: UserProfile | null;
          })
        | null
        | undefined;
    if (sender === null || sender === undefined) {
        return null;
    }
    const profile = sender.profile ?? null;
    const name =
        profile !== null
            ? (profile.name ?? 'بدون نام')
            : (sender.name ?? 'بدون نام');
    const username =
        profile !== null
            ? (profile.username ?? null)
            : (sender.username ?? null);
    const photos =
        profile !== null ? (profile.avatars ?? []) : (sender.avatars ?? []);
    const current = photos[0];

    return {
        id: num(sender.id),
        name,
        username,
        avatars: current === undefined ? [] : [current],
    };
}

/**
 * Message wire shape: numeric ids, top-level `chatId`/`senderId`, the compact
 * sender, the type row and the attachments. No `chat` object. Attachment paths
 * and storage keys never leave the server.
 */
export function serializeMessage(
    message: Message,
    reactions: MessageReactionSummary[] = [],
    myReaction?: string | null,
) {
    // `clientMessageId` is a transient echo field (not persisted): history
    // pages and older messages simply do not carry it.
    const clientMessageId = (
        message as Message & { clientMessageId?: string | null }
    ).clientMessageId;
    return {
        id: num(message.id),
        content: message.content ?? null,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        isEdited: message.isEdited,
        isDeleted: message.isDeleted,
        chatId: num(message.chat?.id ?? 0),
        senderId: num(message.sender?.id ?? 0),
        sender: serializeMessageSender(message),
        replyToId:
            message.replyTo !== undefined && message.replyTo !== null
                ? num(message.replyTo.id)
                : null,
        replyTo: serializeReplyPreview(message.replyTo),
        forwardedFrom:
            message.forwardedFromUserId == null &&
            message.forwardedFromName == null
                ? null
                : {
                      userId:
                          message.forwardedFromUserId == null
                              ? null
                              : num(message.forwardedFromUserId),
                      name: message.forwardedFromName ?? '',
                  },
        typeId: message.type?.id ? num(message.type.id) : null,
        type: message.type
            ? { id: num(message.type.id), name: message.type.name }
            : null,
        attachments: (message.attachments ?? []).map((attachment) =>
            serializeAttachmentMeta(attachment),
        ),
        // Count-only summaries: no react ids or reactor ids in message payloads.
        reactions: reactions.map(({ emoji, count }) => ({ emoji, count })),
        // Only history (`getMessages`) personalizes this; broadcasts omit it.
        ...(myReaction !== undefined ? { myReaction } : {}),
        ...(clientMessageId !== undefined && clientMessageId !== null
            ? { clientMessageId }
            : {}),
    };
}
