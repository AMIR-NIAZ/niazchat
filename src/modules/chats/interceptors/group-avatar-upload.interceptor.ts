import {
    BadRequestException,
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
    Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { diskStorage } from 'multer';
import { Observable } from 'rxjs';
import { EXT_BY_MIME } from 'src/modules/attachments/utils/file-signature.util';
import {
    AVATAR_EXTENSIONS,
    AVATAR_MAX_FILE_SIZE,
    ensureAvatarDirectory,
    isAvatarMimeType,
} from 'src/modules/auth/utils/avatar.util';

/** Request field carrying the multer target so an aborted upload can clean up. */
const UPLOAD_PATH_KEY = '__groupAvatarPath';

/**
 * Group photo upload (multipart field `avatar`).
 *
 * Reuses the user-avatar rules (`uploads/avatars`, random server-generated
 * name, extension from the declared MIME, 5 MiB cap), so the existing
 * thumbnail route serves group photos with no change. When the client aborts
 * mid-upload the partially written file is removed immediately.
 */
@Injectable()
export class GroupAvatarUploadInterceptor implements NestInterceptor {
    private readonly delegate: NestInterceptor;

    constructor() {
        const directory = ensureAvatarDirectory();

        const Interceptor: Type<NestInterceptor> = FileInterceptor('avatar', {
            storage: diskStorage({
                destination: directory,
                filename: (req, file, cb) => {
                    const extension =
                        EXT_BY_MIME[file.mimetype.toLowerCase()] ??
                        AVATAR_EXTENSIONS[0];
                    const name = `${randomUUID()}.${extension}`;
                    // Record the target before bytes arrive: an aborted request
                    // must not leave a partial file behind.
                    (req as unknown as Record<string, unknown>)[
                        UPLOAD_PATH_KEY
                    ] = join(directory, name);
                    cb(null, name);
                },
            }),
            limits: { fileSize: AVATAR_MAX_FILE_SIZE, files: 1, fields: 5 },
            fileFilter: (_req, file, cb) => {
                if (!isAvatarMimeType(file.mimetype)) {
                    cb(
                        new BadRequestException(
                            `avatar must be an image file (${AVATAR_EXTENSIONS.join(
                                ', ',
                            )})`,
                        ),
                        false,
                    );
                    return;
                }
                cb(null, true);
            },
        }) as unknown as Type<NestInterceptor>;
        this.delegate = new Interceptor();
    }

    /**
     * Nest's `FileInterceptor` implements `intercept` as an ASYNC method, so it
     * returns a Promise<Observable> at runtime even though the interceptor type
     * allows a plain Observable. Awaiting it here is what makes the multer
     * pipeline run at all; treating the Promise as an Observable used to throw
     * `stream.subscribe is not a function` (500) on every group photo upload.
     */
    async intercept(
        context: ExecutionContext,
        next: CallHandler,
    ): Promise<Observable<unknown>> {
        const request = context.switchToHttp().getRequest<
            {
                on?: (event: string, listener: () => void) => void;
                aborted?: boolean;
                /** False when the client went away before the body ended. */
                complete?: boolean;
                file?: { path?: string };
            } & Record<string, unknown>
        >();

        let finished = false;
        const cleanup = (): void => {
            if (finished) return;
            const target =
                request.file?.path ??
                (request[UPLOAD_PATH_KEY] as string | undefined);
            if (typeof target === 'string' && target !== '') {
                void fs.promises.unlink(target).catch((): void => undefined);
            }
        };
        request.on?.('aborted', cleanup);
        // 'close' also fires after a NORMAL request: only treat it as an abort
        // when the body never completed, otherwise the just-uploaded file would
        // be deleted before the service can validate it.
        request.on?.('close', (): void => {
            if (request.complete !== true) {
                cleanup();
            }
        });

        const stream = await this.delegate.intercept(context, next);
        return new Observable<unknown>((subscriber) => {
            const subscription = stream.subscribe({
                next: (value) => {
                    finished = true;
                    if (request.aborted === true) {
                        cleanup();
                    }
                    subscriber.next(value);
                },
                error: (error) => {
                    finished = true;
                    cleanup();
                    subscriber.error(error);
                },
                complete: () => subscriber.complete(),
            });
            return (): void => subscription.unsubscribe();
        });
    }
}
