/**
 * Shared content ("chat profile" tabs) DTOs — response of the WS
 * `getChatMedia` handler.
 */

export type SharedContentType = 'media' | 'voice' | 'music' | 'links' | 'files';

/** Attachment metadata, identical to the message wire shape. */
export interface SharedAttachmentMetaDto {
    id: number;
    originalName: string;
    mimeType: string;
    size: number;
    kind: 'image' | 'video' | 'voice' | 'music' | 'file';
    width?: number;
    height?: number;
    /** Videos/voice, seconds. */
    duration?: number;
    hasPoster?: boolean;
    /** Voice only: 64 bars 0..100, or null. */
    waveform?: number[] | null;
    /** Music only. */
    title?: string;
    artist?: string | null;
    durationSeconds?: number | null;
    /** Music only: server-relative cover route, or null. */
    coverUrl?: string | null;
    createdAt?: string;
}

export interface SharedContentSenderDto {
    id: number;
    /** Empty when this sender blocked the viewer. */
    name: string;
    avatarUrl: string | null;
}

export interface SharedAttachmentItemDto {
    attachment: SharedAttachmentMetaDto;
    messageId: number;
    sender: SharedContentSenderDto;
    /** Message creation time (ISO). */
    createdAt: string;
}

export interface SharedLinkItemDto {
    id: number;
    messageId: number;
    url: string;
    domain: string;
    snippet: string;
    sender: SharedContentSenderDto;
    createdAt: string;
}

export interface SharedContentPageDto<T> {
    items: T[];
    /** Opaque cursor for the next (older) page; null when exhausted. */
    nextCursor: string | null;
}
