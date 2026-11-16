import { BLOCKED_EXTENSIONS } from '../attachment.constants';

/**
 * Content/name helpers for uploads. The client MIME type is never used to make
 * a security decision: images are verified with sharp by the service, other
 * files get their MIME from the (allowlisted) extension and are downloaded as
 * `application/octet-stream` with `nosniff`.
 */

export const MIME_BY_EXT: Record<string, string> = {
    // audio-only containers (music tracks)
    aac: 'audio/aac',
    flac: 'audio/flac',
    weba: 'audio/webm',
    // images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    // documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    md: 'text/markdown',
    rtf: 'application/rtf',
    // archives
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    // audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    opus: 'audio/opus',
    // video
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
};

export const EXT_BY_MIME: Record<string, string> = Object.fromEntries(
    Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext]),
);

/** Lowercase extension (without the dot) of a display name, or ''. */
export function extensionOf(name: string | undefined): string {
    const base = (name ?? '').split(/[\\/]/).pop() ?? '';
    const index = base.lastIndexOf('.');
    if (index < 0 || index === base.length - 1) return '';
    return base.slice(index + 1).toLowerCase();
}

export function isBlockedExtension(name: string | undefined): boolean {
    return BLOCKED_EXTENSIONS.includes(extensionOf(name));
}

/**
 * Detects an audio container from magic bytes, or null. Only containers whose
 * signature is unambiguous are recognised here: the client MIME type is never
 * trusted, and an extension that does not match the real container is
 * rejected by the upload service.
 */
export function detectAudioMimeType(buffer: Buffer): string | null {
    if (buffer.length < 12) return null;
    const ascii = (start: number, end: number): string =>
        buffer.slice(start, end).toString('ascii');

    if (ascii(0, 3) === 'ID3') {
        return 'audio/mpeg';
    }
    if (buffer[0] === 0xff) {
        // MPEG audio frame sync: second byte starts with 111 (0xE0).
        if (((buffer[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';
        // ADTS AAC frame sync: second byte 1111 (0xF0).
        if (((buffer[1] ?? 0) & 0xf6) === 0xf0) return 'audio/aac';
    }
    if (ascii(0, 4) === 'fLaC') {
        return 'audio/flac';
    }
    if (ascii(0, 4) === 'OggS') {
        // Ogg carries Vorbis or Opus; the container MIME is the same.
        return 'audio/ogg';
    }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') {
        return 'audio/wav';
    }
    if (ascii(4, 8) === 'ftyp') {
        const brand = ascii(8, 12);
        if (brand === 'M4A ' || brand === 'M4B ') return 'audio/mp4';
        // isom/mp42 may still be audio-only; the caller verifies the streams.
        return brand === 'isom' || brand.startsWith('mp4')
            ? 'audio/mp4'
            : null;
    }
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
        // EBML (webm/matroska): audio or video, decided by the probe.
        return 'audio/webm';
    }
    return null;
}

/** Detects a raster image format from magic bytes, or null. */
export function detectFileMimeType(buffer: Buffer): string | null {
    if (buffer.length < 12) return null;

    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
    ) {
        return 'image/png';
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    if (
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        (buffer[3] === 0x37 || buffer[3] === 0x39)
    ) {
        return 'image/gif';
    }
    if (
        buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
        buffer.slice(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp';
    }
    return null;
}

/**
 * Multer/busboy decodes multipart file names as latin1, so a UTF-8 name
 * (Persian, emoji, accented) arrives mojibake'd. Re-interpret the string as raw
 * bytes and decode them as UTF-8, but only when that round-trips cleanly — an
 * already-correct ASCII/latin1 name is returned untouched.
 */
export function decodeMultipartFileName(rawName: string): string {
    // Some multipart encoders send `filename*=UTF-8''<percent-encoded>`.
    const extended = /^utf-8''(.+)$/i.exec(rawName);
    if (extended !== null) {
        try {
            return decodeURIComponent(extended[1] ?? '');
        } catch {
            return rawName;
        }
    }
    // eslint-disable-next-line no-control-regex
    if (!/[^\x00-\x7f]/.test(rawName)) {
        return rawName;
    }
    const asUtf8 = Buffer.from(rawName, 'latin1').toString('utf8');
    if (asUtf8.includes('\uFFFD')) {
        return rawName;
    }
    const roundTrip = Buffer.from(asUtf8, 'utf8').toString('latin1');
    return roundTrip === rawName ? asUtf8 : rawName;
}

/**
 * Builds a safe display filename out of a client-provided one: keeps only the
 * last path segment, strips control/path characters and caps the length at 200
 * characters. The result is purely informational; storage never uses it.
 */
export function sanitizeOriginalName(rawName: string | undefined): string {
    const decoded = decodeMultipartFileName(rawName ?? 'file');
    const basename = decoded.split(/[\\/]/).pop() ?? 'file';
    const cleaned = basename
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
        .trim();
    return cleaned.length ? cleaned.slice(0, 200) : 'file';
}
