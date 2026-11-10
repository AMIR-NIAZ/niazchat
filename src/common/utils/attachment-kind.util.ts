/** Wire kind of an attachment: media renders inline, everything else as a row. */
export type AttachmentKind = 'image' | 'video' | 'voice' | 'file';

/**
 * `image` only for the verified raster image MIME types the upload service
 * stores, `video` only for the containers probed and accepted at upload time,
 * `voice` only for rows the voice upload path flagged. Everything else is a
 * generic file (never rendered inline).
 *
 * The `voice` flag is authoritative: an `audio/mp4` file uploaded as a normal
 * attachment stays a file, while the same container uploaded with `voice=1`
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
    return 'file';
}
