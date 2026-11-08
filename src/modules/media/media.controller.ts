import {
    BadRequestException,
    Controller,
    Get,
    Logger,
    NotFoundException,
    Param,
    Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsPublic } from 'src/common/decorators/public.decorator';
import { AvatarThumbnailService } from './avatar-thumbnail.service';
import {
    AVATAR_THUMBNAIL_CACHE_CONTROL,
    AVATAR_THUMBNAIL_SIZES,
    isAvatarThumbnailSize,
    safeAvatarFileName,
} from './avatar-thumbnail.util';

/**
 * Public avatar thumbnails: `GET /media/avatars/:size/:fileName`.
 *
 * Same visibility rule as the originals under `/uploads` (which are served by
 * static middleware, outside the guards), so the app needs no special header.
 * `:size` is a closed allowlist; `:fileName` is a strict basename.
 */
@Controller('media')
export class MediaController {
    private readonly logger = new Logger(MediaController.name);

    constructor(private readonly thumbnails: AvatarThumbnailService) {}

    @Get('avatars/:size/:fileName')
    @IsPublic()
    async avatarThumbnail(
        @Param('size') rawSize: string,
        @Param('fileName') rawFileName: string,
        @Res() response: Response,
    ): Promise<void> {
        const size = Number(rawSize);
        if (!/^\d+$/.test(rawSize) || !isAvatarThumbnailSize(size)) {
            throw new BadRequestException(
                `size must be one of ${AVATAR_THUMBNAIL_SIZES.join(', ')}`,
            );
        }
        const fileName = safeAvatarFileName(rawFileName);
        if (fileName === null) {
            throw new BadRequestException('invalid avatar file name');
        }

        let result: { path: string; generated: boolean };
        try {
            result = await this.thumbnails.get(size, fileName);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            this.logger.warn(
                `thumbnail generation failed for ${fileName}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            throw new BadRequestException('could not process this image');
        }

        response.setHeader('Cache-Control', AVATAR_THUMBNAIL_CACHE_CONTROL);
        // Observability only: lets the client/script see cache vs generation.
        response.setHeader(
            'X-Avatar-Thumbnail',
            result.generated ? 'generated' : 'hit',
        );
        // `sendFile` adds ETag + Last-Modified and answers conditional requests
        // (304) with an empty body.
        response.sendFile(result.path, {
            headers: { 'Cache-Control': AVATAR_THUMBNAIL_CACHE_CONTROL },
        });
    }
}
