/**
 * Chat DTOs (docs/mobile-api/chats.md, websocket.md).
 */

export type ChatType = 'private' | 'groupe' | 'channel';

/**
 * Chat-member roles (seeded `role_chat` names). `manager` is the group OWNER;
 * `admin` is an ordinary chat admin and must never be treated as the owner.
 */
export type ChatRole = 'manager' | 'admin' | 'user' | 'ban';

/**
 * Chat-list preview carried by both WS sources (`getAllChats` rows and the
 * `chatlist:updated` event) — identical shape on the server.
 */
export interface ChatLastMessageDto {
    id: number;
    content: string;
    senderId: number;
    createdAt: string;
    attachments: Array<{
        id: number;
        originalName: string;
        mimeType: string;
        size: number;
    }>;
}

/**
 * Raw `Chat` entity row, as returned by the WS `getAllChats` / `chatInfo`
 * events (`lastMessage`, `messages`, `members` are NOT loaded there).
 */
export interface ChatDto {
    id: number;
    createdAt: string;
    updatedAt: string;
    /** Private chats have no title. */
    title: string | null;
    avatars: string[];
    type: ChatType;
    isBan: boolean;
    /** Authoritative unread count from `getAllChats` (capped server-side). */
    unreadCount?: number;
    /** Present on the `joinChat` ack (`chatInfo`): read position before joining. */
    myLastSeenId?: number | null;
    /** Present on the `joinChat` ack: max read position among other members. */
    othersLastSeenId?: number | null;
    /** Non-banned member count (older backends omit it). */
    membersCount?: number | null;
    /**
     * Present on the `joinChat` ack (`chatInfo`): the caller's own chat role.
     * `manager` = group owner, `admin` = regular chat admin, `null` = banned.
     */
    myRole?: ChatRole | null;
    /** Null when the chat has no message yet; loaded in `getAllChats`. */
    lastMessage?: ChatLastMessageDto | null;
    /** Present but mostly unloaded in list payloads. */
    lastMessageId?: number | null;
}

/** `POST /chats/create` body. The call does NOT return the created chat — refetch via WS. Matches the backend `createChatDto`: members optional (creator is the initial member/admin) and passed as STRINGS (`@IsString({ each: true })`). */
export interface CreateGroupPayloadDto {
    /** Max 20 chars. */
    title: string;
    /** User IDs as strings; optional — empty means only the creator. Duplicates and the caller's own id are filtered server-side. */
    members?: string[];
}
