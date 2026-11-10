import type { AttachmentKind } from '../messages/messages-model';
import { voicePreviewLabel } from './duration';

/**
 * Text used wherever a message preview must summarize attachments (chat list,
 * reply quotes, composer reply bar). Pure so it can be unit tested.
 */
export function attachmentPreviewLabel(
    count: number,
    kind: AttachmentKind | null | undefined,
    name?: string | null,
    durationSeconds?: number | null,
): string {
    if (count <= 0) {
        return '';
    }
    if (kind === 'voice') {
        return voicePreviewLabel(durationSeconds);
    }
    if (kind === 'image') {
        return count === 1 ? '📷 Photo' : `📷 ${count} photos`;
    }
    if (kind === 'video') {
        return count === 1 ? '🎬 Video' : `🎬 ${count} videos`;
    }
    const fileName = (name ?? '').trim();
    if (fileName !== '') {
        return count === 1 ? `📎 ${fileName}` : `📎 ${count} files`;
    }
    return count === 1 ? '📎 File' : `📎 ${count} files`;
}

/** Human file size (0 B / 12 KB / 4.2 MB). */
export function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    if (bytes < 1024) {
        return `${Math.round(bytes)} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}
