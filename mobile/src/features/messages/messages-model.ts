import type { MessageTypeName } from '../../core/api/dto/message.dto';

/**
 * Domain model for the conversation screen (UI-facing), distinct from the wire
 * `MessageDto`.
 */

/** Server-confirmed messages plus one optimistic entry per in-flight send. */
export type MessageStatus = 'pending' | 'sent' | 'failed';

export type AttachmentKind = 'image' | 'video' | 'voice' | 'file';
export type AttachmentUploadStatus = 'uploading' | 'uploaded' | 'failed';

/** One attachment of a message (server metadata + local upload state). */
export interface AttachmentView {
    /** Stable key: `a-<id>` once uploaded, `local-<localKey>` while pending. */
    key: string;
    id: number | null;
    name: string;
    mimeType: string;
    size: number;
    kind: AttachmentKind;
    width?: number;
    height?: number;
    /** Video duration in seconds (videos only). */
    duration?: number;
    /** Voice only: 64 bars, integers 0..100 (null/absent -> flat bars). */
    waveform?: number[];
    /** Voice only, optimistic bubble: duration/waveform recorded locally. */
    localDuration?: number;
    localWaveform?: number[];
    /** Videos only: the server stored a poster (false -> placeholder tile). */
    hasPoster?: boolean;
    /** Local file URI for optimistic previews (pending messages only). */
    localUri?: string;
    status: AttachmentUploadStatus;
    progress?: number;
    /** Short user-facing reason when `status` is `failed`. */
    error?: string | null;
}

/** Compact quoted-message preview rendered at the top of a reply bubble. */
export interface ReplyPreview {
    id: number;
    /** Null when the original was deleted. */
    content: string | null;
    senderId: number;
    senderName: string;
    type: MessageTypeName;
    attachmentsCount: number;
    /** Kind of the first attachment (drives the "Photo"/file label). */
    attachmentKind: AttachmentKind | null;
    /** Duration of a voice first attachment, when known. */
    attachmentDuration: number | null;
    isDeleted: boolean;
}

export interface ChatMessage {
    /**
     * Stable FlatList key: the server message id when known, a virtual
     * `pending-<n>` key while optimistic, so pending and confirmed coexist.
     */
    key: string;
    /** Null while the message is pending (no server id yet). */
    id: number | null;
    type: MessageTypeName;
    /** Null for attachment-only messages. */
    content: string | null;
    createdAtIso: string;
    isEdited: boolean;
    isDeleted: boolean;
    senderId: number;
    senderName: string;
    /** Resolved (absolute) avatar urls of the sender, when present. */
    senderAvatarUrls: string[];
    /** Server-relative CURRENT avatar path — the input for a thumbnail URL. */
    senderAvatarPath: string | null;
    /** Attachments in wire order (empty for text-only messages). */
    attachments: AttachmentView[];
    /** Derived from `attachments`; kept for existing consumers. */
    attachmentsCount: number;
    /** Echo-matching id of an optimistic send (null on history messages). */
    clientMessageId: string | null;
    /** First forward origin; null for ordinary messages. */
    forwardedFrom: { userId: number | null; name: string } | null;
    /** Quoted preview when this message replies to another, else null. */
    replyTo: ReplyPreview | null;
    /** Wire id of the replied-to message, kept even if the preview is null. */
    replyToId: number | null;
    status: MessageStatus;
    /** Populated for failed `sendMessage` attempts so a tap can retry verbatim. */
    pendingContent: string | null;
}

/** "7" | 7 → 7; anything that is not a finite number → null.
 * Shared normalizer: ids arrive as bigint STRINGS on the wire; a single
 * source of truth so every mine/other comparison is number === number.
 */
export function toNumericId(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The ONLY ownership comparison the UI may use (`mine` bubbles, Edit/Delete,
 * reply "You" labels, unread bumps). Both sides are normalized to numbers, so
 * a bigint-string id can never silently turn every message into someone
 * else's; an unknown current user owns nothing.
 */
export function isOwnMessage(
    currentUserId: number | null | undefined,
    senderId: unknown,
): boolean {
    const me = toNumericId(currentUserId);
    const sender = toNumericId(senderId);
    return me !== null && me > 0 && sender !== null && sender === me;
}

/** True when a message is in the list but not yet confirmed by the server. */
export function isPendingMessage(message: ChatMessage): boolean {
    return message.id === null;
}

/** Timestamp formatting (HH:mm, 24h — matches the chat-list convention). */
export function formatMessageTime(iso: string): string {
    if (iso.length < 16) {
        return '';
    }
    return iso.slice(11, 16);
}

export type DayKey = string;

/** Calendar-day proxy for separators — the UTC date part of the ISO stamp. */
export function dayKeyOf(iso: string): DayKey {
    return iso.slice(0, 10);
}

function isSameDayDayKey(previousIso: string, iso: string): boolean {
    return dayKeyOf(previousIso) === dayKeyOf(iso);
}

/**
 * Human day label for separators, comparing adjacent list entries ("Today" for
 * the newest day).
 */
export function formatDaySeparator(
    previousIso: string,
    iso: string,
): string | null {
    if (isSameDayDayKey(previousIso, iso)) {
        return null;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (dayKeyOf(iso) === today) {
        return 'Today';
    }
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    if (dayKeyOf(iso) === yesterday) {
        return 'Yesterday';
    }
    return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
