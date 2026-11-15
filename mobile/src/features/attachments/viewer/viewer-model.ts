import type { AttachmentView, ChatMessage } from '../../messages/messages-model';
import { formatDuration, hasDuration } from '../duration';
import { formatFileSize } from '../attachment-labels';

/**
 * Pure data for the full-screen media viewer: the flat list of every image and
 * video of a conversation, the labels its chrome shows, and the info sheet.
 * Kept free of React and React Native so it can be reasoned about (and tested)
 * on its own.
 */

/** Window rect of the bubble/tile that opened the viewer (`measureInWindow`). */
export interface ViewerRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** One page: an attachment plus the message it belongs to. */
export interface ViewerItem {
    /** Unique across the conversation (attachment keys are unique). */
    key: string;
    attachment: AttachmentView;
    message: ChatMessage;
}

/** Images and videos are the only kinds the viewer pages through. */
export function isViewerMedia(attachment: AttachmentView): boolean {
    return attachment.kind === 'image' || attachment.kind === 'video';
}

/**
 * Every image/video of the conversation, in message order (oldest first), so
 * the pager can swipe through all of them regardless of which message the
 * opener belonged to.
 */
export function buildViewerItems(
    messages: readonly ChatMessage[],
): ViewerItem[] {
    const items: ViewerItem[] = [];
    for (const message of messages) {
        for (const attachment of message.attachments) {
            if (!isViewerMedia(attachment)) continue;
            items.push({ key: attachment.key, attachment, message });
        }
    }
    return items;
}

/**
 * Index of the item the user tapped: the `mediaIndex`-th image/video of that
 * message. Falls back to the first page when the message is gone (deleted
 * between the tap and the mount) or carries no media.
 */
export function initialViewerIndex(
    items: readonly ViewerItem[],
    messageKey: string | null,
    mediaIndex: number,
): number {
    if (items.length === 0) return 0;
    let seen = -1;
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item === undefined || item.message.key !== messageKey) continue;
        seen += 1;
        if (seen === mediaIndex) return index;
    }
    return 0;
}

const MONTHS = [
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

function startOfLocalDay(date: Date): number {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
    ).getTime();
}

function clockOf(date: Date): string {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * "Today at 14:03", "Yesterday at 21:10" or "12 Nov 2026 at 09:41".
 * Times are the device's local time, matching the bubbles.
 */
export function viewerDateLabel(iso: string, now: Date = new Date()): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const time = clockOf(date);
    const days = Math.round(
        (startOfLocalDay(now) - startOfLocalDay(date)) / 86_400_000,
    );
    if (days === 0) return `Today at ${time}`;
    if (days === 1) return `Yesterday at ${time}`;
    const month = MONTHS[date.getMonth()] ?? '';
    return `${date.getDate()} ${month} ${date.getFullYear()} at ${time}`;
}

/** "14:03" in local time (the footer's message stamp). */
export function viewerClockLabel(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return clockOf(date);
}

/** Type/dimension line for the caption area and the info sheet. */
export function mediaTypeLabel(attachment: AttachmentView): string {
    const kind = attachment.kind === 'video' ? 'Video' : 'Photo';
    if (
        attachment.width !== undefined &&
        attachment.height !== undefined &&
        attachment.width > 0 &&
        attachment.height > 0
    ) {
        return `${kind} · ${attachment.width} × ${attachment.height}`;
    }
    return kind;
}

/** Rows of the Info dialog: size, dimensions, type, duration and the date. */
export function viewerInfoLines(item: ViewerItem): string[] {
    const { attachment, message } = item;
    const lines: string[] = [];
    lines.push(
        `Type: ${attachment.kind === 'video' ? 'Video' : 'Photo'}${
            attachment.mimeType !== '' ? ` (${attachment.mimeType})` : ''
        }`,
    );
    if (attachment.size > 0) {
        lines.push(`Size: ${formatFileSize(attachment.size)}`);
    }
    if (
        attachment.width !== undefined &&
        attachment.height !== undefined &&
        attachment.width > 0 &&
        attachment.height > 0
    ) {
        lines.push(`Dimensions: ${attachment.width} × ${attachment.height}`);
    }
    if (attachment.kind === 'video' && hasDuration(attachment.duration)) {
        lines.push(`Duration: ${formatDuration(attachment.duration)}`);
    }
    lines.push(`Sent: ${viewerDateLabel(message.createdAtIso)}`);
    return lines;
}

/** Screen-reader announcement for a page change. */
export function viewerPageLabel(
    item: ViewerItem | undefined,
    index: number,
    total: number,
): string {
    const kind = item?.attachment.kind === 'video' ? 'Video' : 'Image';
    return `${kind} ${index + 1} of ${total}`;
}
