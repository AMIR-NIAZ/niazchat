import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { MIME_BY_EXT } from './utils/file-signature.util';

/**
 * Upload configuration resolved once at startup and validated eagerly:
 * a bad UPLOAD_MAX_FILE_SIZE or UPLOAD_ALLOWED_EXTENSIONS must fail the boot,
 * not the first request.
 */
@Injectable()
export class AttachmentConfig {
    readonly maxFileSize: number;
    readonly allowedExtensions: string[];
    readonly allowedMimeTypes: string[];
    readonly storageDir: string;

    constructor(configService: ConfigService) {
        const maxSize = Number(
            configService.get<string>('UPLOAD_MAX_FILE_SIZE') ?? 10485760, // 10 MiB
        );
        if (!Number.isFinite(maxSize) || maxSize <= 0) {
            throw new Error(
                'UPLOAD_MAX_FILE_SIZE must be a positive number of bytes',
            );
        }

        const extensions = (
            configService.get<string>('UPLOAD_ALLOWED_EXTENSIONS') ??
            'jpg,jpeg,png,gif,webp,pdf,mp4,mp3,txt'
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

        const storageDir =
            configService.get<string>('STORAGE_DIR') ?? './storage';
        if (!storageDir.trim()) {
            throw new Error('STORAGE_DIR must not be empty');
        }

        this.maxFileSize = Math.trunc(maxSize);
        this.allowedExtensions = extensions;
        this.allowedMimeTypes = [
            ...new Set(extensions.map((ext) => MIME_BY_EXT[ext])),
        ];
        // Absolute, normalized base directory. Files are always joined inside
        // it with server-generated keys only, so no path traversal is possible.
        this.storageDir = path.resolve(storageDir, 'attachments');
    }

    isMimeAllowed(mime: string): boolean {
        return this.allowedMimeTypes.includes(mime.toLowerCase());
    }

    extensionForMime(mime: string): string {
        for (const ext of this.allowedExtensions) {
            if (MIME_BY_EXT[ext] === mime.toLowerCase()) return ext;
        }
        throw new Error(`no extension configured for mime type ${mime}`);
    }
}
