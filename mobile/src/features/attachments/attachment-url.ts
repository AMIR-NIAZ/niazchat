import { env } from '../../core/config/env';
import {
    DEFAULT_ATTACHMENT_PREVIEW_SIZE,
    MAX_ATTACHMENT_FILE_SIZE,
    MAX_ATTACHMENT_MESSAGE_SIZE,
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_VIDEO_FILE_SIZE,
} from './constants';

/**
 * The single place that builds attachment URLs. Components must never
 * concatenate paths themselves.
 */
export function attachmentUrl(id: number): string {
    return `${env.apiUrl}/attachments/${id}/download`;
}

export function attachmentPreviewUrl(
    id: number,
    size: number = DEFAULT_ATTACHMENT_PREVIEW_SIZE,
): string {
    return `${env.apiUrl}/attachments/${id}/preview?size=${size}`;
}

/**
 * Absolute URL of a music cover. The wire sends the server-relative route
 * (`/attachments/<id>/cover`), which lives on the API origin, NOT under
 * `/uploads` — so it must never go through `absoluteUploadUrl`.
 */
export function attachmentCoverUrl(
    coverUrl: string | null | undefined,
    id: number | null,
): string | null {
    if (coverUrl === null || coverUrl === undefined || coverUrl === '') {
        return id === null ? null : `${env.apiUrl}/attachments/${id}/cover`;
    }
    if (/^https?:\/\//i.test(coverUrl)) {
        return coverUrl;
    }
    return `${env.apiUrl}${coverUrl.startsWith('/') ? '' : '/'}${coverUrl}`;
}

/** Multipart upload route for a chat. */
export function chatAttachmentsUrl(chatId: number): string {
    return `${env.apiUrl}/chats/${chatId}/attachments`;
}

/** Mirrored constants, re-exported for screens/components. */
export {
    DEFAULT_ATTACHMENT_PREVIEW_SIZE,
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_ATTACHMENT_FILE_SIZE,
    MAX_VIDEO_FILE_SIZE,
    MAX_ATTACHMENT_MESSAGE_SIZE,
};
