import { absoluteUploadUrl } from '../../core/config/env';
import type {
    MessageDto,
    MessageReplyDto,
} from '../../core/api/dto/message.dto';
import { dayKeyOf, isPendingMessage, toNumericId } from './messages-model';
import type { ChatMessage, ReplyPreview } from './messages-model';

/**
 * Wire → domain mapping (docs/mobile-api/messages.md):
 * - `type` is the entity row → use `type.name`, never `typeId`.
 * - sender avatars are server-relative → absolutize like chat avatars.
 * - Deleted messages reach the client ONLY via `deleteMessage:list` (history
 *   excludes them); we drop them from the cache rather than render tombstones.
 * - Ids (message, sender, reply) arrive as bigint STRINGS ("7"); they are
 *   normalized to numbers here, once, so every comparison in the app is
 *   number === number.
 * - Replies carry a compact `replyTo` preview (content already truncated by the
 *   server); the same preview is built locally for optimistic pending bubbles.
 *
 * Cache contract: the message list is ALWAYS ascending (oldest → newest);
 * local (not yet confirmed) messages — pending or failed — come last.
 */

const virtalPendingKeyPrefix = 'pending-';
/** Must match the backend preview truncation (ws-serializer.utils.ts). */
const REPLY_PREVIEW_MAX_LENGTH = 200;

function truncateReplyContent(
    content: string | null | undefined,
): string | null {
    if (content === null || content === undefined) {
        return null;
    }
    return content.length <= REPLY_PREVIEW_MAX_LENGTH
        ? content
        : `${content.slice(0, REPLY_PREVIEW_MAX_LENGTH)}…`;
}

function senderNameOf(dto: MessageDto): string {
    return dto.sender?.name ?? '';
}

/** Sender id from the flat field, falling back to the nested `sender.id` (entity broadcast). */
function senderIdOf(dto: MessageDto): number {
    const nested = (dto as unknown as { sender?: { id?: unknown } }).sender?.id;
    return toNumericId(dto.senderId) ?? toNumericId(nested) ?? -1;
}

export function replyPreviewFromDto(
    dto: MessageReplyDto | null | undefined,
): ReplyPreview | null {
    if (dto === null || dto === undefined) {
        return null;
    }
    const id = toNumericId(dto.id);
    if (id === null) {
        return null;
    }
    return {
        id,
        content: dto.isDeleted ? null : truncateReplyContent(dto.content),
        senderId: toNumericId(dto.senderId) ?? -1,
        senderName: dto.senderName ?? '',
        type: dto.type ?? 'text',
        attachmentsCount: dto.attachmentsCount ?? 0,
        isDeleted: dto.isDeleted === true,
    };
}

/** Build the quoted preview of an already-loaded message (optimistic sends). */
export function toReplyPreview(message: ChatMessage): ReplyPreview | null {
    if (message.id === null) {
        return null;
    }
    return {
        id: message.id,
        content: message.isDeleted
            ? null
            : truncateReplyContent(message.content),
        senderId: message.senderId,
        senderName: message.senderName,
        type: message.type,
        attachmentsCount: message.attachmentsCount,
        isDeleted: message.isDeleted,
    };
}

export function toChatMessage(dto: MessageDto): ChatMessage {
    return {
        key: String(dto.id),
        id: toNumericId(dto.id),
        type: dto.type?.name ?? 'text',
        content: dto.content,
        createdAtIso: dto.createdAt,
        isEdited: dto.isEdited,
        isDeleted: dto.isDeleted,
        senderId: senderIdOf(dto),
        senderName: senderNameOf(dto),
        senderAvatarUrls: (dto.sender?.avatars ?? []).map(absoluteUploadUrl),
        // Kept server-relative so the bubble can ask for a small thumbnail;
        // the absolute list above stays for the full-URL consumers.
        senderAvatarPath: dto.sender?.avatars?.[0] ?? null,
        attachmentsCount: dto.attachments?.length ?? 0,
        replyTo: replyPreviewFromDto(dto.replyTo),
        replyToId: toNumericId(dto.replyToId),
        status: 'sent',
        pendingContent: null,
    };
}

export function toPendingChatMessage(
    key: string,
    content: string,
    senderId: number,
    replyTo: ReplyPreview | null = null,
): ChatMessage {
    return {
        key: `${virtalPendingKeyPrefix}${key}`,
        id: null,
        type: 'text',
        content,
        createdAtIso: new Date().toISOString(),
        isEdited: false,
        isDeleted: false,
        senderId,
        senderName: '',
        senderAvatarUrls: [],
        senderAvatarPath: null,
        attachmentsCount: 0,
        replyTo,
        replyToId: replyTo === null ? null : replyTo.id,
        status: 'pending',
        pendingContent: content,
    };
}

export function toFailedChatMessage(message: ChatMessage): ChatMessage {
    return { ...message, status: 'failed' };
}

function sameContent(local: ChatMessage, confirmed: ChatMessage): boolean {
    return (
        (confirmed.content ?? '').trim() === (local.pendingContent ?? '').trim()
    );
}

/**
 * The original of a reply was edited: update every cached quoted preview that
 * points at it (immutable). The reply itself is never changed by an edit.
 */
export function applyOriginalEdited(
    current: ChatMessage[],
    edited: ChatMessage,
): ChatMessage[] {
    if (edited.id === null) {
        return current;
    }
    const targetId = edited.id;
    return current.map((message) => {
        if (message.replyTo === null || message.replyTo.id !== targetId) {
            return message;
        }
        return {
            ...message,
            replyTo: {
                ...message.replyTo,
                content: edited.isDeleted
                    ? null
                    : truncateReplyContent(edited.content),
                type: edited.type,
                attachmentsCount: edited.attachmentsCount,
                isDeleted: edited.isDeleted,
            },
        };
    });
}

/**
 * The original of a reply was deleted: cached replies switch to the
 * content-less "deleted" preview without a refetch.
 */
export function applyOriginalDeleted(
    current: ChatMessage[],
    messageId: number | string,
): ChatMessage[] {
    const targetId = toNumericId(messageId);
    if (targetId === null) {
        return current;
    }
    return current.map((message) =>
        message.replyTo !== null && message.replyTo.id === targetId
            ? {
                  ...message,
                  replyTo: {
                      ...message.replyTo,
                      content: null,
                      isDeleted: true,
                  },
              }
            : message,
    );
}

/**
 * Merges server-confirmed messages with locally-pending sends:
 * - De-duplicate by id: a live event never creates a second copy.
 * - A NEW confirmed message from me (the room echo — `sendMessage:list` also
 *   reaches the sender, that IS the confirmation) consumes exactly ONE local
 *   bubble with the same content: the oldest pending one, otherwise a failed
 *   one (the send timed out but actually went through).
 * - Result is ascending: confirmed messages sorted by numeric id, then the
 *   remaining local (pending/failed) messages in creation order.
 */
export function mergeMessages(
    current: ChatMessage[],
    incoming: ChatMessage[],
    currentUserId: number,
): ChatMessage[] {
    const confirmed = new Map<number, ChatMessage>();
    const locals: ChatMessage[] = [];

    for (const message of current) {
        if (message.id === null) {
            locals.push(message);
        } else {
            confirmed.set(message.id, message);
        }
    }

    const consumedKeys = new Set<string>();
    // `currentUserId` may itself be a bigint string ("2") coming from the profile API.
    const me = toNumericId(currentUserId);

    for (const message of incoming) {
        if (message.isDeleted || message.id === null) {
            continue;
        }
        const existing = confirmed.get(message.id);
        if (existing !== undefined) {
            // Already known (duplicate echo / re-delivery): update, never consume a bubble.
            // The echo is authoritative and carries `replyTo`, so the preview survives.
            confirmed.set(message.id, { ...existing, ...message });
            continue;
        }
        confirmed.set(message.id, message);

        // senderId === -1 means the echo carried no sender at all (unknown): still
        // eligible, because only a message with identical text can consume a bubble.
        if (message.senderId === me || message.senderId === -1) {
            const available = (status: ChatMessage['status']) =>
                locals.find(
                    (local) =>
                        local.status === status &&
                        !consumedKeys.has(local.key) &&
                        sameContent(local, message),
                );
            const target = available('pending') ?? available('failed');
            if (target !== undefined) {
                consumedKeys.add(target.key);
            }
        }
    }

    const confirmedList = [...confirmed.values()].sort(
        (a, b) => (a.id ?? 0) - (b.id ?? 0),
    );
    const remainingLocals = locals.filter(
        (local) => !consumedKeys.has(local.key),
    );

    return [...confirmedList, ...remainingLocals];
}

/** Marks every pending entry for the chat as failed (e.g. on send timeout). */
export function failPendingMessages(
    current: ChatMessage[],
    keys: string[],
): ChatMessage[] {
    const failedKeys = new Set(keys);
    return current.map((message) =>
        isPendingMessage(message) && failedKeys.has(message.key)
            ? toFailedChatMessage(message)
            : message,
    );
}

/** `deleteMessage:list` only carries the id (may be a string) — find and remove. */
export function removeMessageById(
    current: ChatMessage[],
    messageId: number | string,
): ChatMessage[] {
    const target = toNumericId(messageId);
    if (target === null) {
        return current;
    }
    return current.filter((message) => message.id !== target);
}

/** Replaces a message in place after an `editMessage:list` broadcast.
 * Merges into the existing entry so fields a light echo does not carry
 * (sender display name, avatars, quoted preview) are never wiped. */
export function replaceMessage(
    current: ChatMessage[],
    updated: ChatMessage,
): ChatMessage[] {
    if (updated.id === null) {
        return current;
    }
    return current.map((message) =>
        message.id === updated.id
            ? {
                  ...message,
                  ...updated,
                  senderName:
                      updated.senderName !== ''
                          ? updated.senderName
                          : message.senderName,
                  senderAvatarUrls:
                      updated.senderAvatarUrls.length !== 0
                          ? updated.senderAvatarUrls
                          : message.senderAvatarUrls,
                  // A reply keeps its quoted preview even if a light echo omits it.
                  replyTo: updated.replyTo ?? message.replyTo,
                  replyToId: updated.replyToId ?? message.replyToId,
              }
            : message,
    );
}

/** Removed a failed pending entry (used by the retry-tap action before resend). */
export function dropPendingKeys(
    current: ChatMessage[],
    keys: string[],
): ChatMessage[] {
    const drop = new Set(keys);
    return current.filter((message) => !drop.has(message.key));
}

export { dayKeyOf };
