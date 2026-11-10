/** Wire summary attached to every message payload. */
export interface MessageReactionSummary {
    emoji: string;
    count: number;
}

/** Internal aggregation (includes user ids only for per-recipient personalization). */
export interface ReactionEntry extends MessageReactionSummary {
    reactId: number;
    userIds: number[];
}

export interface ReactionActor {
    userId: number;
    emoji: string | null;
}

/** Viewer-neutral snapshot; never emitted as-is. */
export interface ReactionState {
    chatId: number;
    messageId: number;
    reactions: ReactionEntry[];
    actor: ReactionActor;
}

export interface ReactionToggleResult extends ReactionState {
    /** False for a no-op (e.g. clearing a reaction that did not exist). */
    changed: boolean;
}

/** Broadcast/ack snapshot: no user ids leave the server. */
export interface ReactionSnapshot {
    chatId: number;
    messageId: number;
    reactions: Array<MessageReactionSummary & { reactId: number }>;
    actor: ReactionActor;
}

export interface ReactionSnapshotForViewer extends ReactionSnapshot {
    myReaction: string | null;
}

export interface ReactionUser {
    userId: number;
    name: string;
    username: string | null;
    avatars: string[];
}

export interface ReactionGroup {
    emoji: string;
    count: number;
    users: ReactionUser[];
}
