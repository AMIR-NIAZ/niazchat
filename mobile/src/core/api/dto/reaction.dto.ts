/** Reaction DTOs (docs/mobile-api/websocket-contract.md). */

/** Emoji catalog row from `GET /react`. */
export interface ReactionTypeDto {
    id: number;
    name: string;
    emoji: string;
}

/** Count-only summary carried on every message payload. */
export interface MessageReactionDto {
    emoji: string;
    count: number;
}

/** Personalized `reaction:updated` / `reactMessage` ack snapshot. */
export interface ReactionSnapshotDto {
    chatId: number;
    messageId: number;
    reactions: Array<{
        reactId?: number;
        emoji: string;
        count: number;
    }>;
    myReaction: string | null;
    actor: { userId: number; emoji: string | null };
}

export interface ReactionUserDto {
    userId: number;
    name: string;
    username: string | null;
    /** Current avatar only, server-relative. */
    avatars: string[];
}

export interface ReactionGroupDto {
    emoji: string;
    count: number;
    users: ReactionUserDto[];
}

/** `getMessageReactions` ack data. */
export interface MessageReactionsDto {
    reactions: ReactionGroupDto[];
}
