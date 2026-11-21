import type { MessageDto } from '../../core/api/dto/message.dto';
import type {
    SharedAttachmentItemDto,
    SharedContentType,
    SharedLinkItemDto,
} from '../../core/api/dto/shared-content.dto';
import type { AttachmentView, ChatMessage } from '../messages/messages-model';

/**
 * Pure model for the chat profile's shared content.
 *
 * Everything here is free of React/React Native so the grouping, labels and
 * the "which tab does this message affect" rule can be reasoned about (and
 * unit-tested) separately from the list rendering.
 */

/** Tabs of the profile: the shared-content tabs plus the group Members tab. */
export type SharedProfileTab = SharedContentType | 'members';

export interface SharedTabDefinition {
    type: SharedContentType;
    label: string;
    emptyTitle: string;
    emptyHint: string;
}

export const SHARED_TABS: readonly SharedTabDefinition[] = [
    {
        type: 'media',
        label: 'Photos',
        emptyTitle: 'No shared photos yet',
        emptyHint: 'Photos and videos sent in this chat will appear here.',
    },
    {
        type: 'voice',
        label: 'Voice',
        emptyTitle: 'No voice messages yet',
        emptyHint: 'Voice messages sent in this chat will appear here.',
    },
    {
        type: 'music',
        label: 'Music',
        emptyTitle: 'No shared music yet',
        emptyHint: 'Audio files sent in this chat will appear here.',
    },
    {
        type: 'links',
        label: 'Links',
        emptyTitle: 'No shared links yet',
        emptyHint: 'Links sent in this chat will appear here.',
    },
    {
        type: 'files',
        label: 'Files',
        emptyTitle: 'No shared files yet',
        emptyHint: 'Documents and other files will appear here.',
    },
];

export function tabDefinition(type: SharedContentType): SharedTabDefinition {
    return SHARED_TABS.find((tab) => tab.type === type) ?? SHARED_TABS[0]!;
}

/** Rows rendered by the single shared-content list. */
export type SharedContentRow =
    | { kind: 'month'; key: string; label: string }
    | { kind: 'media-row'; key: string; items: SharedAttachmentItemDto[] }
    | { kind: 'attachment'; key: string; item: SharedAttachmentItemDto }
    | { kind: 'link'; key: string; item: SharedLinkItemDto };

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
] as const;

const SHORT_MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
] as const;

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** Stable month bucket key (`2026-11`) from an ISO timestamp. */
export function monthKeyOf(iso: string): string {
    return iso.slice(0, 7);
}

/** "November 2026" — the section header for every tab. */
export function monthLabelOf(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const month = MONTHS[date.getMonth()] ?? '';
    return `${month} ${date.getFullYear()}`;
}

/** "12 Nov 2026, 14:03" in the device's local time (24h, like bubbles). */
export function sharedDateLabel(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const month = SHORT_MONTHS[date.getMonth()] ?? '';
    return `${date.getDate()} ${month} ${date.getFullYear()}, ${pad(
        date.getHours(),
    )}:${pad(date.getMinutes())}`;
}

/**
 * Flattens one tab's pages into list rows:
 *   - a month header whenever the month/year changes,
 *   - media in rows of three (3-column square grid),
 *   - voice/music/files as one row per item,
 *   - links as one row per link (a message with several URLs shows each).
 *
 * The list is newest-first, matching the server pages.
 */
export function buildSharedRows(
    type: SharedContentType,
    pages: ReadonlyArray<SharedAttachmentItemDto | SharedLinkItemDto>,
): SharedContentRow[] {
    const rows: SharedContentRow[] = [];
    let currentMonth: string | null = null;
    let mediaChunk: SharedAttachmentItemDto[] = [];

    const flushMedia = (): void => {
        if (mediaChunk.length === 0) return;
        rows.push({
            kind: 'media-row',
            key: `media-${mediaChunk.map((item) => item.attachment.id).join('-')}`,
            items: mediaChunk,
        });
        mediaChunk = [];
    };

    for (const pageItem of pages) {
        const month = monthKeyOf(pageItem.createdAt);
        if (month !== currentMonth) {
            flushMedia();
            currentMonth = month;
            const label = monthLabelOf(pageItem.createdAt);
            if (label !== '') {
                rows.push({ kind: 'month', key: `month-${month}`, label });
            }
        }

        if (type === 'media') {
            mediaChunk.push(pageItem as SharedAttachmentItemDto);
            if (mediaChunk.length === 3) {
                flushMedia();
            }
            continue;
        }
        if (type === 'links') {
            const link = pageItem as SharedLinkItemDto;
            rows.push({ kind: 'link', key: `link-${link.id}`, item: link });
            continue;
        }
        const attachment = pageItem as SharedAttachmentItemDto;
        rows.push({
            kind: 'attachment',
            key: `att-${attachment.attachment.id}`,
            item: attachment,
        });
    }
    flushMedia();
    return rows;
}

/** True when the text contains an `http(s)://` or `www.` link. */
export function textContainsLink(content: string | null | undefined): boolean {
    return (
        typeof content === 'string' &&
        /(?:https?:\/\/|www\.)[^\s]+/i.test(content)
    );
}

/**
 * Tabs a live `sendMessage:list` / `editMessage:list` event can affect.
 * Only these queries are invalidated — never the whole section.
 */
export function affectedTabsForMessage(
    message: MessageDto,
): SharedContentType[] {
    const affected = new Set<SharedContentType>();
    for (const attachment of message.attachments ?? []) {
        const kind = attachment.kind;
        if (kind === 'image' || kind === 'video') {
            affected.add('media');
        } else if (kind === 'voice') {
            affected.add('voice');
        } else if (kind === 'music') {
            affected.add('music');
        } else if (kind === 'file') {
            affected.add('files');
        }
    }
    if (textContainsLink(message.content)) {
        affected.add('links');
    }
    return [...affected];
}

/** One viewer message per media item, so the existing viewer can page them. */
export function viewerMessageOf(item: SharedAttachmentItemDto): ChatMessage {
    const attachment = item.attachment;
    const view: AttachmentView = {
        key: `a-${attachment.id}`,
        id: attachment.id,
        name: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind === 'video' ? 'video' : 'image',
        status: 'uploaded',
        ...(attachment.width !== undefined ? { width: attachment.width } : {}),
        ...(attachment.height !== undefined
            ? { height: attachment.height }
            : {}),
        ...(attachment.duration !== undefined
            ? { duration: attachment.duration }
            : {}),
        ...(attachment.hasPoster !== undefined
            ? { hasPoster: attachment.hasPoster }
            : {}),
    };
    return {
        key: `shared-${attachment.id}`,
        id: item.messageId,
        type: attachment.kind === 'video' ? 'video' : 'image',
        content: null,
        createdAtIso: item.createdAt,
        isEdited: false,
        isDeleted: false,
        isPinned: false,
        pinnedAtIso: null,
        senderId: item.sender.id,
        senderName: item.sender.name,
        senderAvatarUrls:
            item.sender.avatarUrl === null ? [] : [item.sender.avatarUrl],
        senderAvatarPath: item.sender.avatarUrl,
        attachments: [view],
        attachmentsCount: 1,
        clientMessageId: null,
        forwardedFrom: null,
        reactions: [],
        myReaction: null,
        myReactionProvided: false,
        service: null,
        replyTo: null,
        replyToId: null,
        status: 'sent',
        pendingContent: null,
    };
}

/** Rows of at most three square tiles (the section's grid). */
export const MEDIA_GRID_COLUMNS = 3;
