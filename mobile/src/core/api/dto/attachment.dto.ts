/**
 * Attachment DTOs (docs/mobile-api/attachments.md).
 */

/** Kind decided by the server after verifying the stored file's content. */
export type AttachmentKindDto = 'image' | 'video' | 'voice' | 'music' | 'file';

/** `POST /chats/:chatId/attachments` response item (`StoredAttachment`). */
export interface AttachmentUploadResponseDto {
    id: number;
    originalName: string;
    mimeType: string;
    size: number;
    kind: AttachmentKindDto;
    width?: number;
    height?: number;
    /** Videos only, seconds. */
    duration?: number;
    /** Videos only: a poster was generated (otherwise the app shows a placeholder). */
    hasPoster?: boolean;
    /** Voice only: 64 bars 0..100, or absent when generation failed. */
    waveform?: number[];
    /** Music only: embedded tag title, or the file name without extension. */
    title?: string;
    /** Music only: embedded tag artist; null means "Unknown artist". */
    artist?: string | null;
    /** Music only: container duration in seconds (one decimal), or null. */
    durationSeconds?: number | null;
    /** Music only: server-relative cover route, or null without a cover. */
    coverUrl?: string | null;
}

/** `POST /attachments/:id/stream-url` response. */
export interface AttachmentStreamUrlDto {
    url: string;
    expiresAt: string;
}
