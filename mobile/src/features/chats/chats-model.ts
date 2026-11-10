import type { ChatDto, ChatRole, ChatType } from '../../core/api/dto/chat.dto';

/**
 * Domain models for the chats feature (UI-facing), distinct from wire DTOs.
 */

export interface ChatLastMessage {
    id: number;
    content: string;
    /** Display name of the sender when known (chatlist:updated events only). */
    senderName: string | null;
    senderId: number;
    createdAt: string;
    attachmentCount: number;
    /** Kind/name of the first attachment (drives the preview label). */
    firstAttachmentKind: 'image' | 'video' | 'voice' | 'file' | null;
    /** Duration of a voice first attachment, when the server sent one. */
    firstAttachmentDuration: number | null;
    firstAttachmentName: string | null;
}

/** Other participant of a private chat (server `PeerDto`, ids numeric). */
export interface ChatPeer {
    id: number;
    name: string;
    username: string;
    /** Current photo only; server-relative path. */
    avatars: string[];
    isOnline: boolean;
    lastSeen: string | null;
}

/** A conversation as the UI renders it. */
export interface ChatPreview {
    id: number;
    type: ChatType;
    /** Null for private chats (no title server-side). */
    title: string | null;
    /** Other participant's name for private chats (search/forward picker). */
    peerName?: string | null;
    /** Other participant of a private chat; null for groups. */
    peer: ChatPeer | null;
    isBan: boolean;
    avatarUrls: string[];
    createdAt: string;
    /** Entity updatedAt — a fallback ordering signal when no lastMessage exists. */
    updatedAt: string;
    /** From `getAllChats` and live `chatlist:updated` events (same shape). */
    lastMessage: ChatLastMessage | null;
    /** Authoritative from `getAllChats`; live updates increment locally. */
    unreadCount: number;
}

/** Full chat info from the WS `chatInfo` event (after `joinChat`). */
export interface ChatInfo {
    id: number;
    type: ChatType;
    title: string | null;
    peer: ChatPeer | null;
    isBan: boolean;
    avatarUrls: string[];
    createdAt: string;
    updatedAt: string;
    /** Read position before this join (null = no seen row yet). */
    myLastSeenId: number | null;
    /** Max read position among the other (non-banned) members. */
    othersLastSeenId: number | null;
    /** Non-banned member count, refreshed live by `chat:members`. */
    membersCount: number | null;
}

/**
 * The group owner is the `manager` chat role. `admin` is an ordinary chat
 * admin (kick/ban rights depending on permissions), never the owner.
 */
export function isGroupOwner(role: ChatRole | null | undefined): boolean {
    return role === 'manager';
}

/**
 * The ONLY private-chat test in the app. Based on the server `type`; an
 * unknown/missing type is treated as a group (group behavior is the safe
 * default: no presence subtitle, no peer navigation).
 */
export function isPrivateChat(
    chat: { type?: ChatType | null } | null | undefined,
): boolean {
    return chat?.type === 'private';
}

/** Anything the display helper can read: ChatPreview, ChatInfo or ChatDto. */
export interface ChatDisplaySource {
    type?: ChatType | null;
    title?: string | null;
    peer?: ChatPeer | null;
    /** Absolute group-photo URLs (chat list rows). */
    avatarUrls?: string[];
    /** Server-relative group photos (chat info / wire rows). */
    avatars?: string[];
}

export interface ChatDisplay {
    title: string;
    /** Server-relative or absolute current avatar; null = initials. */
    avatarUri: string | null;
    /** Private chat: the peer's user id (avatar identity + profile target). */
    userId: number | null;
}

/**
 * Name/avatar of a conversation: `peer` for private chats, group data
 * otherwise. A private chat with no peer (older backend) falls back to the
 * generic label instead of rendering an empty row.
 */
export function getChatDisplay(
    chat: ChatDisplaySource | null | undefined,
): ChatDisplay {
    if (chat === null || chat === undefined) {
        return { title: 'Unnamed group', avatarUri: null, userId: null };
    }
    if (isPrivateChat(chat)) {
        const peer = chat.peer ?? null;
        const peerName = peer?.name?.trim();
        return {
            title:
                peerName !== undefined && peerName !== ''
                    ? peerName
                    : chat.title?.trim() || 'Private chat',
            avatarUri: peer?.avatars?.[0] ?? null,
            userId: peer?.id ?? null,
        };
    }
    return {
        title: chat.title?.trim() || 'Unnamed group',
        avatarUri: chat.avatarUrls?.[0] ?? chat.avatars?.[0] ?? null,
        userId: null,
    };
}

export type { ChatRole, ChatType, ChatDto as ChatWire };
