import type { ChatDto, ChatType } from '../..//core/api/dto/chat.dto';

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
}

/** A conversation as the UI renders it. */
export interface ChatPreview {
    id: number;
    type: ChatType;
    /** Null for private chats (no title server-side). */
    title: string | null;
    isBan: boolean;
    avatarUrls: string[];
    createdAt: string;
    /** Entity updatedAt — a fallback ordering signal when no lastMessage exists. */
    updatedAt: string;
    /** From `getAllChats` and live `chatlist:updated` events (same shape). */
    lastMessage: ChatLastMessage | null;
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
}

export type { ChatType, ChatDto as ChatWire };
