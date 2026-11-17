import { absoluteUploadUrl } from '../../core/config/env';
import { attachmentCoverUrl } from '../attachments/attachment-url';
import type {
    MessageDto,
    MessageReplyDto,
} from '../../core/api/dto/message.dto';
import { dayKeyOf, isPendingMessage, toNumericId } from './messages-model';
import { toServiceMessage } from './service-message';
import type {
    AttachmentKind,
    AttachmentView,
    ChatMessage,
    ReplyPreview,
} from './messages-model';

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

function kindOfMime(
    mimeType: string | null | undefined,
    kind: AttachmentKind | null | undefined,
): AttachmentKind {
    if (
        kind === 'image' ||
        kind === 'video' ||
        kind === 'voice' ||
        kind === 'music' ||
        kind === 'file'
    ) {
        return kind;
    }
    const mime = (mimeType ?? '').toLowerCase();
    if (
        mime === 'image/jpeg' ||
        mime === 'image/png' ||
        mime === 'image/webp' ||
        mime === 'image/gif'
    ) {
        return 'image';
    }
    if (
        mime === 'video/mp4' ||
        mime === 'video/quicktime' ||
        mime === 'video/webm'
    ) {
        return 'video';
    }
    if (mime.startsWith('audio/')) {
        return 'music';
    }
    return 'file';
}

/**
 * Wire attachments → attachment views (confirmed messages). Music rows carry
 * their track metadata; the cover route is absolutized like other upload URLs.
 */
export function toAttachmentViews(dto: MessageDto): AttachmentView[] {
    return (dto.attachments ?? []).map((attachment) => {
        const id = toNumericId(attachment.id);
        const kind = kindOfMime(attachment.mimeType, attachment.kind);
        return {
            key: `a-${attachment.id}`,
            id,
            name: attachment.originalName,
            mimeType: attachment.mimeType,
            size: Number(attachment.size),
            kind,
            ...(attachment.width !== undefined &&
            attachment.height !== undefined
                ? { width: attachment.width, height: attachment.height }
                : {}),
            ...(attachment.duration !== undefined
                ? { duration: attachment.duration }
                : {}),
            ...(Array.isArray(attachment.waveform)
                ? { waveform: attachment.waveform }
                : {}),
            ...(attachment.hasPoster !== undefined
                ? { hasPoster: attachment.hasPoster }
                : {}),
            ...(kind === 'music'
                ? {
                      title: attachment.title ?? attachment.originalName,
                      artist: attachment.artist ?? null,
                      durationSeconds:
                          typeof attachment.durationSeconds === 'number'
                              ? attachment.durationSeconds
                              : null,
                      coverUrl: attachmentCoverUrl(attachment.coverUrl, id),
                  }
                : {}),
            status: 'uploaded',
        };
    });
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
        attachmentDuration:
            typeof dto.attachmentDuration === 'number'
                ? dto.attachmentDuration
                : null,
        attachmentKind:
            (dto.attachmentsCount ?? 0) > 0
                ? kindOfMime(undefined, dto.attachmentKind ?? null)
                : null,
        attachmentTitle: dto.attachmentTitle ?? null,
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
        attachmentKind: message.attachments[0]?.kind ?? null,
        attachmentDuration: message.attachments[0]?.duration ?? null,
        attachmentTitle: message.attachments[0]?.title ?? null,
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
        attachments: toAttachmentViews(dto),
        attachmentsCount: dto.attachments?.length ?? 0,
        reactions: (dto.reactions ?? [])
            .filter(
                (reaction) =>
                    typeof reaction.emoji === 'string' &&
                    Number.isFinite(Number(reaction.count)) &&
                    Number(reaction.count) > 0,
            )
            .map((reaction) => ({
                emoji: reaction.emoji,
                count: Number(reaction.count),
            })),
        // Broadcasts omit myReaction; history acks always include it (null = none).
        myReaction: dto.myReaction ?? null,
        myReactionProvided: Object.prototype.hasOwnProperty.call(
            dto,
            'myReaction',
        ),
        clientMessageId: dto.clientMessageId ?? null,
        forwardedFrom:
            dto.forwardedFrom === null || dto.forwardedFrom === undefined
                ? null
                : {
                      userId: toNumericId(dto.forwardedFrom.userId),
                      name: dto.forwardedFrom.name ?? '',
                  },
        // `system` rows carry `meta`; unknown/malformed meta stays null and the
        // renderer falls back to `content`.
        service:
            dto.type?.name === 'system'
                ? toServiceMessage(dto.meta, dto.content)
                : null,
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
    attachments: AttachmentView[] = [],
    clientMessageId: string | null = null,
    type: ChatMessage['type'] = 'text',
): ChatMessage {
    return {
        key,
        id: null,
        type,
        content,
        createdAtIso: new Date().toISOString(),
        isEdited: false,
        isDeleted: false,
        senderId,
        senderName: '',
        senderAvatarUrls: [],
        senderAvatarPath: null,
        attachments,
        attachmentsCount: attachments.length,
        reactions: [],
        myReaction: null,
        myReactionProvided: false,
        clientMessageId,
        forwardedFrom: null,
        service: null,
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
                attachmentKind: edited.attachments[0]?.kind ?? null,
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
 * Structural equality for mapped messages (plain data: primitives, arrays and
 * plain objects). The FlatList data is only replaced when something REALLY
 * changed, so a re-merge of an unchanged page cannot re-render rows or move
 * the scroll position.
 */
function sameData(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let index = 0; index < a.length; index += 1) {
            if (!sameData(a[index], b[index])) return false;
        }
        return true;
    }
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    for (const key of leftKeys) {
        if (!sameData(left[key], right[key])) return false;
    }
    return true;
}

/**
 * Merges server-confirmed messages with locally-pending sends:
 * - De-duplicate by id: a live event never creates a second copy.
 * - A NEW confirmed message consumes exactly ONE local bubble:
 *   1. first, the bubble with the SAME `clientMessageId` (any status) — the
 *      reliable path, works for empty captions and two identical photos;
 *   2. only when the echo carries no `clientMessageId` (older messages / other
 *      clients), the historical sender + trimmed-content match (oldest pending
 *      first, otherwise failed).
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
            // A broadcast/edit echo omits `myReaction`; keep the cached one.
            const merged: ChatMessage = {
                ...existing,
                ...message,
                myReaction: message.myReactionProvided
                    ? message.myReaction
                    : existing.myReaction,
                myReactionProvided:
                    existing.myReactionProvided || message.myReactionProvided,
            };
            // Identical content: keep the CACHED object so the row (and the
            // array around it) keeps its identity.
            if (!sameData(merged, existing)) {
                confirmed.set(message.id, merged);
            }
            continue;
        }
        confirmed.set(message.id, message);

        // Service messages are server-authored: they can never be the echo of
        // an optimistic local bubble, even when the text happens to match.
        if (message.type === 'system') {
            continue;
        }

        // 1) Exact echo match: the app generated this id for this send.
        if (
            message.clientMessageId !== null &&
            message.clientMessageId !== undefined
        ) {
            const byClientId = locals.find(
                (local) =>
                    !consumedKeys.has(local.key) &&
                    local.clientMessageId === message.clientMessageId,
            );
            if (byClientId !== undefined) {
                consumedKeys.add(byClientId.key);
            }
            continue;
        }

        // 2) Legacy fallback for messages without a client id.
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

    const result = [...confirmedList, ...remainingLocals];
    // Nothing changed (same objects, same order): hand back the SAME array so
    // the list data, its memoized derivations and the scroll position stay put.
    const unchanged =
        result.length === current.length &&
        result.every((item, index) => item === current[index]);
    return unchanged ? current : result;
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
                  // Broadcast echoes omit myReaction; history/ack values win.
                  myReaction: updated.myReactionProvided
                      ? updated.myReaction
                      : message.myReaction,
                  myReactionProvided:
                      message.myReactionProvided || updated.myReactionProvided,
              }
            : message,
    );
}

/**
 * Merges one authoritative server page over the cached list:
 * - every confirmed cached message INSIDE the server page's id range that is
 *   missing from the page was deleted server-side → it is dropped;
 * - messages outside the range (older loaded pages, live arrivals) and local
 *   pending/failed bubbles survive;
 * - the page is then merged normally (dedupe by id, pending/failed last).
 */
export function reconcileMessages(
    current: ChatMessage[],
    incoming: ChatMessage[],
    currentUserId: number,
): ChatMessage[] {
    const serverIds = new Set<number>();
    let minId = Number.POSITIVE_INFINITY;
    let maxId = Number.NEGATIVE_INFINITY;
    for (const message of incoming) {
        if (message.id === null || message.isDeleted) {
            continue;
        }
        serverIds.add(message.id);
        minId = Math.min(minId, message.id);
        maxId = Math.max(maxId, message.id);
    }
    if (serverIds.size === 0) {
        return mergeMessages(current, incoming, currentUserId);
    }
    let dropped = false;
    const kept = current.filter((message) => {
        if (message.id === null || serverIds.has(message.id)) {
            return true;
        }
        if (message.id < minId || message.id > maxId) {
            return true;
        }
        dropped = true;
        return false;
    });
    // Nothing was dropped: merge against the ORIGINAL array so `mergeMessages`
    // can hand back the very same reference when the page changed nothing.
    return mergeMessages(dropped ? kept : current, incoming, currentUserId);
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
