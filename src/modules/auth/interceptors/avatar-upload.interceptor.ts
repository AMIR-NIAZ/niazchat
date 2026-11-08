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
import { diskStorage } from 'multer';
import { Observable } from 'rxjs';
import { EXT_BY_MIME } from 'src/modules/attachments/utils/file-signature.util';
import {
    AVATAR_EXTENSIONS,
    AVATAR_MAX_FILE_SIZE,
    ensureAvatarDirectory,
    isAvatarMimeType,
} from '../utils/avatar.util';

/**
 * Profile picture upload (multipart field `avatar`).
 *
 * Same storage contract as the rest of the app: files land on disk under
 * `uploads/avatars` (relative to the process cwd) and are exposed by the
 * `ServeStaticModule` mount at `/uploads`, so the profile stores the
 * server-relative path (`uploads/avatars/<name>.<ext>`), never a full URL.
 *
 * The directory is created eagerly: multer's disk storage does not create
 * missing folders, so a fresh clone / a volume without the folder previously
 * failed the very first upload with ENOENT.
 */
@Injectable()
export class AvatarUploadInterceptor implements NestInterceptor {
    private readonly delegate: NestInterceptor;

    constructor() {
        const directory = ensureAvatarDirectory();

        const Interceptor: Type<NestInterceptor> = FileInterceptor('avatar', {
            storage: diskStorage({
                destination: directory,
                // Random server-generated name, extension from the declared
                // MIME type (never the client filename). The service sniffs the
                // bytes and rejects a declared/detected mismatch.
                filename: (_req, file, cb) => {
                    const extension =
                        EXT_BY_MIME[file.mimetype.toLowerCase()] ??
                        AVATAR_EXTENSIONS[0];
                    cb(null, `${randomUUID()}.${extension}`);
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

    intercept(
        context: ExecutionContext,
        next: CallHandler,
    ): Observable<unknown> {
        return this.delegate.intercept(context, next) as Observable<unknown>;
    }
}
