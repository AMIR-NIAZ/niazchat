import { absoluteUploadUrl } from '../../core/config/env';
import { attachmentPreviewLabel } from '../attachments/attachment-labels';
import type { ChatDto } from '../../core/api/dto/chat.dto';
import type { ChatListUpdateDto } from '../../core/api/dto/message.dto';
import type { UserDto } from '../../core/api/dto/user.dto';
import { getChatDisplay } from './chats-model';
import type { ChatPeer, ChatPreview } from './chats-model';

/**
 * Wire → domain mapping. Rules from the docs:
 * - `avatars` are server-relative paths ("uploads/avatars/…") → absolute URLs here.
 * - The raw WS `getAllChats` payload carries `lastMessage` in the SAME shape as
 *   `chatlist:updated` events (null when the chat has no message) — both map
 *   through the shared `lastMessageFromUpdate` preview mapper.
 */

export function toChatPreview(chat: ChatDto): ChatPreview {
    return {
        id: Number(chat.id),
        type: chat.type,
        title: chat.title ?? null,
        peerName: chat.peerName ?? null,
        peer: toChatPeer(chat.peer),
        isBan: chat.isBan,
        avatarUrls: chat.avatars.map(absoluteUploadUrl),
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        unreadCount: Number(chat.unreadCount ?? 0),
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
        firstAttachmentKind:
            attachments.length === 0
                ? null
                : (attachments[0]?.kind ??
                  (attachments[0]?.mimeType.startsWith('image/')
                      ? 'image'
                      : attachments[0]?.mimeType.startsWith('video/')
                        ? 'video'
                        : 'file')),
        firstAttachmentDuration:
            typeof attachments[0]?.duration === 'number'
                ? attachments[0].duration
                : null,
        firstAttachmentName: attachments[0]?.originalName ?? null,
    };
}

/** Wire peer → domain peer (numbers normalized, name never empty). */
export function toChatPeer(peer: ChatPeer | null | undefined): ChatPeer | null {
    if (peer === null || peer === undefined) {
        return null;
    }
    return {
        id: Number(peer.id),
        name: peer.name?.trim() || 'بدون نام',
        username: peer.username ?? '',
        avatars: peer.avatars ?? [],
        isOnline: peer.isOnline === true,
        lastSeen: peer.lastSeen ?? null,
    };
}

/** Chat-list preview text: text, else a photo/file summary. */
export function chatPreviewText(preview: ChatPreview['lastMessage']): string {
    if (preview === null) {
        return '—';
    }
    if (preview.content.trim() !== '') {
        return preview.content;
    }
    return attachmentPreviewLabel(
        preview.attachmentCount,
        preview.firstAttachmentKind,
        preview.firstAttachmentName,
        preview.firstAttachmentDuration,
    );
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

/**
 * Pinned chats first, preserving the incoming (activity) order inside each
 * group. Partitioning keeps the order explicit instead of relying on sort
 * stability. Pin state is device-local: there is no backend pin field.
 */
export function sortPinnedFirst(
    chats: ChatPreview[],
    pinnedIds: ReadonlySet<number>,
): ChatPreview[] {
    if (pinnedIds.size === 0) {
        return chats;
    }
    const pinnedChats: ChatPreview[] = [];
    const rest: ChatPreview[] = [];
    for (const chat of chats) {
        if (pinnedIds.has(Number(chat.id))) {
            pinnedChats.push(chat);
        } else {
            rest.push(chat);
        }
    }
    return [...pinnedChats, ...rest];
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
        const name = getChatDisplay(chat).title.toLowerCase();
        const preview = chat.lastMessage?.content.toLowerCase() ?? '';
        return name.includes(q) || preview.includes(q);
    });
}
