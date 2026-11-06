import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Attachment } from './entities/attachment.entity';
import { ChatMember } from '../chats/entities/chat_members.entity';
import { RoleChat } from '../chats/entities/role_chat.entity';
import { AttachmentService } from './services/attachment.service';
import {
    AttachmentsController,
    ChatAttachmentsController,
} from './controllers/attachments.controller';
import { AttachmentConfig } from './attachment.config';
import { UploadFileInterceptor } from './interceptors/upload-file.interceptor';
import { IsBanMember } from 'src/common/guards/restGuards/IsBanMember.guard';

@Module({
    imports: [TypeOrmModule.forFeature([Attachment, ChatMember, RoleChat])],
    controllers: [ChatAttachmentsController, AttachmentsController],
    providers: [
        AttachmentService,
        IsBanMember,
        {
            provide: AttachmentConfig,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) =>
                new AttachmentConfig(configService),
        },
        {
            // Interceptors used in @UseInterceptors are resolved from the
            // module injector, so its dependency (AttachmentConfig) exists.
            provide: UploadFileInterceptor,
            inject: [AttachmentConfig],
            useFactory: (config: AttachmentConfig) =>
                new UploadFileInterceptor(config),
        },
    ],
    exports: [AttachmentService],
})
export class AttachmentsModule {}
