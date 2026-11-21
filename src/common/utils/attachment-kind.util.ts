/** Wire kind of an attachment: media renders inline, everything else as a row. */
export type AttachmentKind = 'image' | 'video' | 'voice' | 'music' | 'file';

/** Image containers the upload service accepts and renders inline. */
export const IMAGE_MIME_TYPES: readonly string[] = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
];

/** Video containers probed and accepted at upload time. */
export const VIDEO_MIME_TYPES: readonly string[] = [
    'video/mp4',
    'video/quicktime',
    'video/webm',
];

/** Everything the Media tab shows (images + videos). */
export const MEDIA_MIME_TYPES: readonly string[] = [
    ...IMAGE_MIME_TYPES,
    ...VIDEO_MIME_TYPES,
];

/** Audio containers uploaded as music tracks (never as generic files). */
export const MUSIC_MIME_TYPES: readonly string[] = [
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/ogg',
    'audio/opus',
    'audio/wav',
    'audio/x-wav',
    'audio/flac',
    'audio/webm',
];

/**
 * `image` only for the verified raster image MIME types the upload service
 * stores, `video` only for the containers probed and accepted at upload time,
 * `voice` only for rows the voice upload path flagged, `music` for audio rows
 * parsed by music-metadata. Everything else is a generic file (never rendered
 * inline).
 *
 * The `voice` flag is authoritative: an `audio/mp4` file uploaded as a normal
 * attachment becomes music, while the same container uploaded with `voice=1`
 * becomes a voice message.
 */
export function attachmentKindOf(
    mimeType: string | null | undefined,
    voice?: boolean | null,
): AttachmentKind {
    if (voice === true) {
        return 'voice';
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
    if (MUSIC_MIME_TYPES.includes(mime)) {
        return 'music';
    }
    return 'file';
}
