import {
    Injectable,
    NestInterceptor,
    Type,
    CallHandler,
    ExecutionContext,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { diskStorage } from 'multer';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { AttachmentConfig } from '../attachment.config';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../attachment.constants';

/**
 * Multer interceptor whose limits come from the validated AttachmentConfig.
 *
 * Uploads go to DISK (never buffered in memory: a video may be 100 MB) inside
 * a unique per-request temp directory. The service moves validated files to
 * their final storage key; whatever is left in the temp directory when the
 * response closes (validation failure, client abort) is removed here.
 *
 * Accepts the current `files` field and the legacy single `file` field.
 */
@Injectable()
export class UploadFileInterceptor implements NestInterceptor {
    private readonly delegate: NestInterceptor;

    constructor(config: AttachmentConfig) {
        const Interceptor: Type<NestInterceptor> = FileFieldsInterceptor(
            [
                { name: 'files', maxCount: MAX_ATTACHMENTS_PER_MESSAGE },
                { name: 'file', maxCount: MAX_ATTACHMENTS_PER_MESSAGE },
            ],
            {
                storage: diskStorage({
                    destination: (
                        _req: unknown,
                        _file: unknown,
                        callback: (error: Error | null, destination: string) => void,
                    ): void => {
                        const dir = path.join(
                            config.storageDir,
                            '.incoming',
                            crypto.randomUUID(),
                        );
                        fs.mkdir(dir, { recursive: true })
                            .then((): void => callback(null, dir))
                            .catch((error: Error): void => callback(error, ''));
                    },
                    filename: (
                        _req: unknown,
                        _file: unknown,
                        callback: (error: Error | null, filename: string) => void,
                    ): void => {
                        callback(null, `${crypto.randomUUID()}.part`);
                    },
                }),
                limits: {
                    fileSize: config.maxVideoFileSize,
                    files: MAX_ATTACHMENTS_PER_MESSAGE,
                    fields: 10,
                },
            },
        ) as unknown as Type<NestInterceptor>;
        this.delegate = new Interceptor();
    }

    intercept(
        context: ExecutionContext,
        next: CallHandler,
    ): Observable<unknown> {
        const request = context.switchToHttp().getRequest<Request>();
        const response = context.switchToHttp().getResponse<Response>();

        // Multer chooses the destination lazily; once a file exists its
        // directory is the temp root. A response that closes without the
        // service having moved everything out leaves only temp files.
        const cleanup = (): void => {
            const files = collectFiles(request);
            const dirs = new Set(
                files
                    .map((file) => (file.path ? path.dirname(file.path) : ''))
                    .filter((dir) => dir !== ''),
            );
            for (const dir of dirs) {
                void fs.rm(dir, { recursive: true, force: true }).catch(
                    (): void => undefined,
                );
            }
        };
        response.once('close', cleanup);
        request.once('aborted', cleanup);

        return this.delegate.intercept(context, next) as Observable<unknown>;
    }
}

function collectFiles(request: Request): Express.Multer.File[] {
    const uploaded = request.files as
        | Record<string, Express.Multer.File[]>
        | Express.Multer.File[]
        | undefined;
    if (uploaded === undefined) return [];
    if (Array.isArray(uploaded)) return uploaded;
    return Object.values(uploaded).flat();
}
