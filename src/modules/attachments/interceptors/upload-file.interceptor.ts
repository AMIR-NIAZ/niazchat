import {
    Injectable,
    NestInterceptor,
    Type,
    CallHandler,
    ExecutionContext,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { AttachmentConfig } from '../attachment.config';

/**
 * Multer interceptor whose limits come from the validated AttachmentConfig
 * (multipart handling in Nest must be bounded by config, not defaults; the
 * options cannot be read from ConfigService at decoration time).
 */
@Injectable()
export class UploadFileInterceptor implements NestInterceptor {
    private readonly delegate: NestInterceptor;

    constructor(config: AttachmentConfig) {
        const Interceptor: Type<NestInterceptor> = FileInterceptor('file', {
            limits: {
                fileSize: config.maxFileSize,
                files: 1,
                fields: 10,
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
