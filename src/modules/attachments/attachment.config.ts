import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
    ALLOWED_EXTENSIONS,
    ATTACHMENT_CLEANUP_INTERVAL_MS,
    DEFAULT_ATTACHMENT_PREVIEW_SIZE,
    DELETED_ATTACHMENT_TTL_MS,
    MAX_ATTACHMENT_FILE_SIZE,
    MAX_VIDEO_FILE_SIZE,
    ORPHAN_ATTACHMENT_TTL_MS,
} from './attachment.constants';
import { MIME_BY_EXT } from './utils/file-signature.util';

/**
 * Upload configuration resolved once at startup and validated eagerly:
 * a bad size/env value must fail the boot, not the first request.
 */
@Injectable()
export class AttachmentConfig {
    readonly maxFileSize: number;
    readonly maxVideoFileSize: number;
    readonly allowedExtensions: string[];
    readonly storageDir: string;
    readonly previewDir: string;
    readonly orphanTtlMs: number;
    readonly deletedTtlMs: number;
    readonly cleanupIntervalMs: number;
    readonly previewSize: number;
    /** HMAC secret for short-lived, signed video stream URLs (never the JWT secret). */
    readonly streamSecret: string;
    readonly streamUrlTtlMs: number;

    constructor(configService: ConfigService) {
        const maxSize = Number(
            configService.get<string>('UPLOAD_MAX_FILE_SIZE') ??
                MAX_ATTACHMENT_FILE_SIZE,
        );
        if (!Number.isFinite(maxSize) || maxSize <= 0) {
            throw new Error(
                'UPLOAD_MAX_FILE_SIZE must be a positive number of bytes',
            );
        }

        const extensions = (
            configService.get<string>('UPLOAD_ALLOWED_EXTENSIONS') ??
            ALLOWED_EXTENSIONS.join(',')
        )
            .split(',')
            .map((ext) => ext.trim().toLowerCase())
            .filter(Boolean);

        if (!extensions.length) {
            throw new Error(
                'UPLOAD_ALLOWED_EXTENSIONS must contain at least one extension',
            );
        }

        const unknownExt = extensions.find((ext) => !(ext in MIME_BY_EXT));
        if (unknownExt) {
            throw new Error(
                `UPLOAD_ALLOWED_EXTENSIONS contains an unsupported extension: ${unknownExt}`,
            );
        }

        const maxVideoSize = Number(
            configService.get<string>('UPLOAD_MAX_VIDEO_SIZE') ??
                MAX_VIDEO_FILE_SIZE,
        );
        if (!Number.isFinite(maxVideoSize) || maxVideoSize <= 0) {
            throw new Error(
                'UPLOAD_MAX_VIDEO_SIZE must be a positive number of bytes',
            );
        }

        const storageDir =
            configService.get<string>('STORAGE_DIR') ?? './storage';
        if (!storageDir.trim()) {
            throw new Error('STORAGE_DIR must not be empty');
        }

        this.maxFileSize = Math.trunc(maxSize);
        this.maxVideoFileSize = Math.trunc(maxVideoSize);
        this.allowedExtensions = extensions;
        // Absolute, normalized base directory. Files are always joined inside
        // it with server-generated keys only, so no path traversal is possible.
        this.storageDir = path.resolve(storageDir, 'attachments');
        this.previewDir = path.resolve(storageDir, 'attachment-previews');
        this.orphanTtlMs = positiveNumber(
            configService.get<string>('ATTACHMENT_ORPHAN_TTL_MS'),
            ORPHAN_ATTACHMENT_TTL_MS,
        );
        this.deletedTtlMs = positiveNumber(
            configService.get<string>('ATTACHMENT_DELETED_TTL_MS'),
            DELETED_ATTACHMENT_TTL_MS,
        );
        this.cleanupIntervalMs = positiveNumber(
            configService.get<string>('ATTACHMENT_CLEANUP_INTERVAL_MS'),
            ATTACHMENT_CLEANUP_INTERVAL_MS,
        );
        this.previewSize = positiveNumber(
            configService.get<string>('ATTACHMENT_PREVIEW_DEFAULT_SIZE'),
            DEFAULT_ATTACHMENT_PREVIEW_SIZE,
        );

        // A dedicated secret: signed stream URLs are not JWTs and must never
        // reuse the access-token secret. An unset dev value is generated per
        // process (URLs simply expire on restart); production must set it.
        const configuredSecret = configService
            .get<string>('ATTACHMENT_STREAM_SECRET')
            ?.trim();
        this.streamSecret =
            configuredSecret !== undefined && configuredSecret !== ''
                ? configuredSecret
                : crypto.randomBytes(32).toString('hex');
        this.streamUrlTtlMs = positiveNumber(
            configService.get<string>('ATTACHMENT_STREAM_URL_TTL_MS'),
            10 * 60 * 1000,
        );
    }

    isExtensionAllowed(extension: string): boolean {
        return this.allowedExtensions.includes(extension.toLowerCase());
    }

    extensionForMime(mime: string): string {
        for (const ext of this.allowedExtensions) {
            if (MIME_BY_EXT[ext] === mime.toLowerCase()) return ext;
        }
        throw new Error(`no extension configured for mime type ${mime}`);
    }
}

function positiveNumber(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}
