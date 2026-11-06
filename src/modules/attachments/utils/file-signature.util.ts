/**
 * Content-sniffing helpers used to reject uploads whose *actual* bytes do not
 * match the MIME type the client claims. Only types we allowlist are detected;
 * anything unrecognizable here must be text-like and carries no magic bytes.
 */

export const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    txt: 'text/plain',
};

export const EXT_BY_MIME: Record<string, string> = Object.fromEntries(
    Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext]),
);

/** Detects the file type from magic bytes, or null when there is none. */
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
    if (
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46
    ) {
        return 'application/pdf';
    }
    if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
        return 'video/mp4';
    }
    if (
        buffer.slice(0, 3).toString('ascii') === 'ID3' ||
        (buffer[0] === 0xff && (buffer[1] === 0xfb || buffer[1] === 0xf3))
    ) {
        return 'audio/mpeg';
    }

    return null;
}

/**
 * Builds a safe display filename out of a client-provided one: keeps only the
 * last path segment, strips control/path characters and caps the length. The
 * result is purely informational; storage never uses it.
 */
export function sanitizeOriginalName(rawName: string | undefined): string {
    const basename = (rawName ?? 'file').split(/[\\/]/).pop() ?? 'file';
    const cleaned = basename
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f<>:"|?*]/g, '')
        .trim();
    return cleaned.length ? cleaned.slice(0, 255) : 'file';
}
