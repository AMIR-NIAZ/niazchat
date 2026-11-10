/**
 * Attachment limits shared by the upload route, the message DTO/service and
 * the mobile client (mirrored in `mobile/src/features/attachments/constants.ts`).
 */

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** 20 MiB per image/file. */
export const MAX_ATTACHMENT_FILE_SIZE = 20 * 1024 * 1024;
/** 100 MiB per video. */
export const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024;
/** 200 MiB summed over all files of one message/upload request. */
export const MAX_ATTACHMENT_MESSAGE_SIZE = 200 * 1024 * 1024;
/** In-flight upload requests allowed per user. */
export const MAX_CONCURRENT_UPLOADS_PER_USER = 3;

/** Accepted video containers (content is probed, never trusted from the name). */
export const VIDEO_EXTENSIONS: readonly string[] = [
    'mp4',
    'm4v',
    'mov',
    'webm',
];

/** Wire `Content-Type` per accepted container. */
export const VIDEO_MIME_BY_EXT: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
};

/** Hard sanity bounds for probed videos. */
export const MAX_VIDEO_DIMENSION = 8192;
export const MAX_VIDEO_DURATION_SECONDS = 2 * 60 * 60;

/** 15 MiB per voice message (mirrored in the mobile app). */
export const MAX_VOICE_FILE_SIZE = 15 * 1024 * 1024;
/** Recording limit; the server tolerates container overhead up to 11 minutes. */
export const MAX_VOICE_DURATION_SECONDS = 10 * 60;
export const MAX_VOICE_DURATION_TOLERANCE_SECONDS = 11 * 60;
/** Containers that may become a voice message after ffprobe verification. */
export const VOICE_EXTENSIONS: readonly string[] = [
    'm4a',
    'mp4',
    'mp3',
    'ogg',
    'opus',
    'webm',
];
/** Waveform bars, each an integer 0..100. */
export const VOICE_WAVEFORM_BUCKETS = 64;

/** At most this many ffmpeg/ffprobe processes run at once. */
export const MAX_CONCURRENT_MEDIA_PROCESSES = 2;
export const MEDIA_PROBE_TIMEOUT_MS = 15_000;
export const MEDIA_POSTER_TIMEOUT_MS = 30_000;
export const MEDIA_WAVEFORM_TIMEOUT_MS = 30_000;
/** Poster is taken at min(1 s, duration/2), then downscaled to <=1280 px. */
export const POSTER_MAX_WIDTH = 1280;
export const POSTER_WEBP_QUALITY = 75;

/** Unsent (pending) uploads are removed after this long. */
export const ORPHAN_ATTACHMENT_TTL_MS = 6 * 60 * 60 * 1000;
/** Files of soft-deleted messages are removed after this long. */
export const DELETED_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Cleanup job period. */
export const ATTACHMENT_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

/** Preview widths/height cap (cover-or-contain) offered by the preview route. */
export const ATTACHMENT_PREVIEW_SIZES = [320, 640, 1280] as const;
export type AttachmentPreviewSize = (typeof ATTACHMENT_PREVIEW_SIZES)[number];
export const DEFAULT_ATTACHMENT_PREVIEW_SIZE: AttachmentPreviewSize = 640;

/** Long-lived, immutable: attachment ids are never reused. */
export const ATTACHMENT_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** Executable/script types are always rejected, allowlist or not. */
export const BLOCKED_EXTENSIONS: readonly string[] = [
    'exe',
    'bat',
    'cmd',
    'com',
    'scr',
    'msi',
    'sh',
    'bash',
    'apk',
    'jar',
    'js',
    'mjs',
    'cjs',
    'vbs',
    'ps1',
    'dll',
    'app',
    'deb',
    'rpm',
    'bin',
    'iso',
];

/** Types that may be uploaded (extension drives the stored MIME for files). */
export const ALLOWED_EXTENSIONS: readonly string[] = [
    // images (content verified with sharp)
    'jpg',
    'jpeg',
    'png',
    'webp',
    'gif',
    // documents
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'txt',
    'csv',
    'md',
    'rtf',
    // archives
    'zip',
    'rar',
    '7z',
    'tar',
    'gz',
    // audio
    'mp3',
    'wav',
    'ogg',
    'm4a',
    'opus',
    // video (content probed; mkv/avi stay generic files)
    'mp4',
    'm4v',
    'mov',
    'webm',
    'mkv',
    'avi',
];

export const IMAGE_MIME_TYPES: readonly string[] = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
];
