import {
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Req,
    Res,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { AttachmentService } from '../services/attachment.service';
import { Attachment } from '../entities/attachment.entity';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { AttachmentId, ChatId } from 'src/common/types/brands.type';
import { IsBanMember } from 'src/common/guards/restGuards/IsBanMember.guard';
import { UploadFileInterceptor } from '../interceptors/upload-file.interceptor';

/**
 * Chat-scoped upload endpoint. Authentication is enforced by the global
 * PayloadGuard; chat membership and ban status by the existing IsBanMember
 * guard (which reads :chatId from the route params).
 */
@Controller('chats')
export class ChatAttachmentsController {
    constructor(private readonly attachmentService: AttachmentService) {}

    @Post(':chatId/attachments')
    @Role([RoleEnum.ALL])
    @UseGuards(IsBanMember)
    @UseInterceptors(UploadFileInterceptor)
    async upload(
        @UploadedFile() file: Express.Multer.File,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Req() req: RequestAuth,
    ): Promise<AttachmentUploadResponse> {
        const attachment = await this.attachmentService.upload(
            file,
            chatId,
            req.user,
        );

        return toAttachmentResponse(attachment);
    }
}

/** Authorized download of a single attachment, by database id only. */
@Controller('attachments')
export class AttachmentsController {
    constructor(private readonly attachmentService: AttachmentService) {}

    @Get(':id/download')
    @Role([RoleEnum.ALL])
    async download(
        @Param('id', ParseIntPipe) id: AttachmentId,
        @Req() req: RequestAuth,
        @Res() res: Response,
    ) {
        await this.attachmentService.download(id, req.user, res);
    }
}

/** Typed upload response: everything the client needs, nothing internal. */
export class AttachmentUploadResponse {
    id: number;
    originalName: string;
    mimeType: string;
    size: number;
    chatId: number;
    createdAt: Date;
}

export function toAttachmentResponse(
    attachment: Attachment,
): AttachmentUploadResponse {
    return {
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: Number(attachment.size),
        chatId: attachment.chat.id,
        createdAt: attachment.createdAt,
    };
}
