import { Module } from '@nestjs/common';
import { AvatarThumbnailService } from './avatar-thumbnail.service';
import { MediaController } from './media.controller';

/** Avatar thumbnails (no schema, no migration: files are derived on demand). */
@Module({
    controllers: [MediaController],
    providers: [AvatarThumbnailService],
    exports: [AvatarThumbnailService],
})
export class MediaModule {}
