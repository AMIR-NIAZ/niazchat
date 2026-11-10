import {
    BLOCKED_EXTENSIONS,
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_ATTACHMENT_FILE_SIZE,
    MAX_ATTACHMENT_MESSAGE_SIZE,
    MAX_VIDEO_FILE_SIZE,
    VIDEO_EXTENSIONS,
} from './constants';
import type { AttachmentKind } from '../messages/messages-model';

/** Locally selected (not yet uploaded) attachment. */
export interface LocalAttachment {
    /** Unique per selection; also the upload-progress store key. */
    localKey: string;
    uri: string;
    name: string;
    mimeType: string;
    /** Bytes; 0 when the picker did not report a size (server enforces). */
    size: number;
    kind: AttachmentKind;
    width?: number;
    height?: number;
    duration?: number;
    /** Voice only: local 64-bar waveform recorded from the level meter. */
    waveform?: number[];
}

export function extensionOfName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? '';
    const index = base.lastIndexOf('.');
    return index < 0 ? '' : base.slice(index + 1).toLowerCase();
}

export function isBlockedFileName(name: string): boolean {
    return BLOCKED_EXTENSIONS.includes(extensionOfName(name));
}

export interface ValidationResult {
    accepted: LocalAttachment[];
    error: string | null;
}

/**
 * Client-side mirror of the server rules: count, per-file size, message size,
 * blocked extensions. Unknown sizes are accepted here and checked server-side.
 * All-or-nothing: a bad pick rejects the whole batch with one friendly message.
 */
export function validateNewAttachments(
    existing: readonly LocalAttachment[],
    candidates: readonly LocalAttachment[],
): ValidationResult {
    if (existing.length + candidates.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        return {
            accepted: [],
            error: `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files.`,
        };
    }

    let total = existing.reduce((sum, item) => sum + item.size, 0);
    for (const item of candidates) {
        if (isBlockedFileName(item.name)) {
            return {
                accepted: [],
                error: `“${item.name}” is a file type that cannot be sent.`,
            };
        }
        const limit =
            item.kind === 'video'
                ? MAX_VIDEO_FILE_SIZE
                : MAX_ATTACHMENT_FILE_SIZE;
        if (item.size > limit) {
            return {
                accepted: [],
                error:
                    item.kind === 'video'
                        ? `“${item.name}” is larger than 100 MB.`
                        : `“${item.name}” is larger than 20 MB.`,
            };
        }
        total += item.size;
    }
    if (total > MAX_ATTACHMENT_MESSAGE_SIZE) {
        return {
            accepted: [],
            error: 'These files are larger than the 200 MB message limit.',
        };
    }

    return { accepted: [...candidates], error: null };
}

/** Attachment kind from a picker MIME type/name (server re-verifies images). */
export function kindOfSelection(
    mimeType: string | null | undefined,
    name: string,
): AttachmentKind {
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
    const ext = extensionOfName(name);
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
    return VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'file';
}
