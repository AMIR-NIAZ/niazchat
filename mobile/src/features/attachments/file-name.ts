import { BLOCKED_EXTENSIONS } from './constants';

/** Longest file name component we write to the cache. */
export const MAX_CACHED_FILE_NAME_LENGTH = 100;

const MIME_EXTENSIONS: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        'pptx',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/x-rar-compressed': 'rar',
    'application/x-7z-compressed': '7z',
    'application/json': 'json',
    'application/rtf': 'rtf',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
};

const UTI_BY_EXTENSION: Record<string, string> = {
    pdf: 'com.adobe.pdf',
    doc: 'com.microsoft.word.doc',
    docx: 'org.openxmlformats.wordprocessingml.document',
    xls: 'com.microsoft.excel.xls',
    xlsx: 'org.openxmlformats.spreadsheetml.sheet',
    ppt: 'com.microsoft.powerpoint.ppt',
    pptx: 'org.openxmlformats.presentationml.presentation',
    zip: 'public.zip-archive',
    txt: 'public.plain-text',
    csv: 'public.comma-separated-values-text',
    json: 'public.json',
    rtf: 'public.rtf',
    png: 'public.png',
    jpg: 'public.jpeg',
    jpeg: 'public.jpeg',
    gif: 'com.compuserve.gif',
    mp4: 'public.mpeg-4',
    mov: 'com.apple.quicktime-movie',
    mp3: 'public.mp3',
    m4a: 'com.apple.m4a-audio',
    wav: 'com.microsoft.waveform-audio',
};

const MIME_BY_EXTENSION: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    json: 'application/json',
    rtf: 'application/rtf',
    txt: 'text/plain',
    csv: 'text/csv',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    webm: 'video/webm',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
};

function baseNameOf(name: string): string {
    const parts = name.split(/[\\/]/);
    return parts[parts.length - 1] ?? '';
}

/** Lowercase extension when it is a short ASCII token, else empty. */
export function extensionOfFileName(name: string): string {
    const base = baseNameOf(name);
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) {
        return '';
    }
    const extension = base.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(extension) ? extension : '';
}

export function extensionForMime(mimeType: string | null | undefined): string {
    const mime = (mimeType ?? '').trim().toLowerCase();
    return MIME_EXTENSIONS[mime] ?? '';
}

/** Drops C0 controls and DEL (kept as a helper: a regex would lint-fail). */
function stripControlCharacters(value: string): string {
    let result = '';
    for (const char of value) {
        const code = char.charCodeAt(0);
        if (code >= 0x20 && code !== 0x7f) {
            result += char;
        }
    }
    return result;
}

/**
 * Keeps Unicode/Persian characters, strips path/control characters and caps
 * the name at 100 characters while preserving the extension. Falls back to
 * `file-<id>` plus an extension from the MIME type.
 */
export function sanitizeFileName(
    name: string | null | undefined,
    attachmentId: number,
    mimeType?: string | null,
): string {
    const raw = stripControlCharacters(baseNameOf(name ?? ''))
        .replace(/[/\\]/g, '')
        .trim();
    const originalExtension = extensionOfFileName(raw);
    const extension = originalExtension || extensionForMime(mimeType);
    const withoutExtension =
        originalExtension !== ''
            ? raw.slice(0, raw.length - originalExtension.length - 1)
            : raw;
    let base = withoutExtension
        .replace(/^\.+/, '')
        .replace(/[.\s]+$/g, '')
        .trim();
    if (base === '') {
        base = `file-${attachmentId}`;
    }
    const suffix = extension === '' ? '' : `.${extension}`;
    const maxBase = Math.max(1, MAX_CACHED_FILE_NAME_LENGTH - suffix.length);
    base =
        base.slice(0, maxBase).replace(/[.\s]+$/g, '') ||
        `file-${attachmentId}`;
    return `${base}${suffix}`;
}

/** MIME type for an Android VIEW intent, falling back to the extension. */
export function mimeForFileName(
    name: string,
    mimeType: string | null | undefined,
): string {
    const fromServer = (mimeType ?? '').trim().toLowerCase();
    if (fromServer !== '' && fromServer !== 'application/octet-stream') {
        return fromServer;
    }
    return (
        MIME_BY_EXTENSION[extensionOfFileName(name)] ??
        'application/octet-stream'
    );
}

/** Short type label shown under a document name (PDF, DOCX, ZIP, ...). */
export function fileTypeLabel(
    name: string,
    mimeType: string | null | undefined,
): string {
    const extension = extensionOfFileName(name);
    if (extension !== '') {
        return extension.toUpperCase();
    }
    const mime = (mimeType ?? '').toLowerCase();
    const slash = mime.indexOf('/');
    return slash >= 0 ? mime.slice(slash + 1).toUpperCase() : 'FILE';
}

export function utiForFileName(name: string): string | undefined {
    return UTI_BY_EXTENSION[extensionOfFileName(name)];
}

export function isBlockedDocumentName(name: string): boolean {
    const extension = extensionOfFileName(name);
    return extension !== '' && BLOCKED_EXTENSIONS.includes(extension);
}
