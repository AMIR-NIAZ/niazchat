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

/** A conversation as the UI renders it. */
export interface ChatPreview {
    id: number;
    type: ChatType;
    /** Null for private chats (no title server-side). */
    title: string | null;
    /** Other participant's name for private chats (search/forward picker). */
    peerName?: string | null;
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

export type { ChatRole, ChatType, ChatDto as ChatWire };
