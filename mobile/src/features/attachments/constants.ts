/**
 * Attachment limits, mirrored from the backend
 * (`src/modules/attachments/attachment.constants.ts`).
 */

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_ATTACHMENT_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024;
/** Voice messages: 15 MB and 10 minutes (server tolerates 11). */
export const MAX_VOICE_FILE_SIZE = 15 * 1024 * 1024;
export const MAX_VOICE_DURATION_SECONDS = 10 * 60;
export const MIN_VOICE_DURATION_SECONDS = 1;
/** Bars stored per voice attachment (integers 0..100). */
export const VOICE_WAVEFORM_BARS = 64;
export const MAX_ATTACHMENT_MESSAGE_SIZE = 200 * 1024 * 1024;
export const MAX_CONCURRENT_UPLOADS = 3;
/** Videos upload one at a time (images/files keep the shared limit). */
export const MAX_CONCURRENT_VIDEO_UPLOADS = 1;

/** Accepted video containers (the server probes the content). */
export const VIDEO_EXTENSIONS: readonly string[] = [
    'mp4',
    'm4v',
    'mov',
    'webm',
];

export const MAX_COMMENT_LENGTH = 5000;

export const ATTACHMENT_PREVIEW_SIZES = [320, 640, 1280] as const;
export type AttachmentPreviewSize = (typeof ATTACHMENT_PREVIEW_SIZES)[number];
export const DEFAULT_ATTACHMENT_PREVIEW_SIZE: AttachmentPreviewSize = 640;

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

export const IMAGE_EXTENSIONS: readonly string[] = [
    'jpg',
    'jpeg',
    'png',
    'webp',
    'gif',
];
