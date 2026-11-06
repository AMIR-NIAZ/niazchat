import { absoluteUploadUrl } from '../../core/config/env';
import type { ChatDto } from '../../core/api/dto/chat.dto';
import type { ChatListUpdateDto } from '../../core/api/dto/message.dto';
import type { UserDto } from '../../core/api/dto/user.dto';
import type { ChatPreview } from './chats-model';

/**
 * Wire → domain mapping. Rules from the docs:
 * - `avatars` are server-relative paths ("uploads/avatars/…") → absolute URLs here.
 * - The raw WS `getAllChats` payload carries `lastMessage` in the SAME shape as
 *   `chatlist:updated` events (null when the chat has no message) — both map
 *   through the shared `lastMessageFromUpdate` preview mapper.
 */

export function toChatPreview(chat: ChatDto): ChatPreview {
    return {
        id: chat.id,
        type: chat.type,
        title: chat.title,
        isBan: chat.isBan,
        avatarUrls: chat.avatars.map(absoluteUploadUrl),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        lastMessage:
            chat.lastMessage == null
                ? null
                : lastMessageFromUpdate({
                      chatId: chat.id,
                      lastMessage: chat.lastMessage,
                  }),
    };
}

export function lastMessageFromUpdate(
    update: ChatListUpdateDto,
    senderDirectory?: Map<number, UserDto>,
): ChatPreview['lastMessage'] {
    // The chat's last message was deleted: clear the preview (null).
    if (update.lastMessage === null) {
        return null;
    }
    const attachments = update.lastMessage.attachments ?? [];
    return {
        id: update.lastMessage.id,
        content: update.lastMessage.content,
        senderId: update.lastMessage.senderId,
        createdAt: update.lastMessage.createdAt,
        senderName:
            senderDirectory?.get(update.lastMessage.senderId)?.name ?? null,
        attachmentCount: attachments.length,
    };
}

/**
 * Sort key: last activity, newest first — `lastMessage.createdAt`, falling back
 * to chat `updatedAt`, then `createdAt`; compared as timestamps.
 */
function activityAsc(chatA: ChatPreview, chatB: ChatPreview): number {
    const timeA = Date.parse(
        chatA.lastMessage?.createdAt ?? chatA.updatedAt ?? chatA.createdAt,
    );
    const timeB = Date.parse(
        chatB.lastMessage?.createdAt ?? chatB.updatedAt ?? chatB.createdAt,
    );
    return timeB - timeA;
}

/** Newest-first chat list (stable sort; ISO dates parsed once per comparison). */
export function sortChatsByActivity(chats: ChatPreview[]): ChatPreview[] {
    return [...chats].sort(activityAsc);
}

/** Client-side search (the backend exposes no chat-search endpoint). */
export function filterChats(
    chats: ChatPreview[],
    query: string,
): ChatPreview[] {
    const q = query.trim().toLowerCase();
    if (q === '') {
        return chats;
    }
    return chats.filter((chat) => {
        const name = chat.title?.toLowerCase() ?? '';
        const preview = chat.lastMessage?.content.toLowerCase() ?? '';
        return name.includes(q) || preview.includes(q);
    });
}
