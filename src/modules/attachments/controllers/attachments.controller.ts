import {
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Query,
    Req,
    Res,
    UploadedFiles,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
    AttachmentService,
    StoredAttachment,
} from '../services/attachment.service';
import { Role } from 'src/common/decorators/role.decorator';
import { RoleEnum } from 'src/common/enums/role.enum';
import { IsPublic } from 'src/common/decorators/public.decorator';
import { RequestAuth } from 'src/common/types/RequestAuth.type';
import { AttachmentId, ChatId } from 'src/common/types/brands.type';
import { IsBanMember } from 'src/common/guards/restGuards/IsBanMember.guard';
import { UploadFileInterceptor } from '../interceptors/upload-file.interceptor';
import { AttachmentDownloadAuthGuard } from '../guards/attachment-download-auth.guard';

/**
 * Chat-scoped upload endpoint. Authentication is enforced by the global
 * PayloadGuard; chat membership and ban status by the existing IsBanMember
 * guard (which reads :chatId from the route params).
 *
 * Multipart field: `files` (up to 10). The legacy single `file` field is also
 * accepted. Files travel over HTTP; the message referencing their ids travels
 * over the WebSocket.
 */
@Controller('chats')
export class ChatAttachmentsController {
    constructor(private readonly attachmentService: AttachmentService) {}

    @Post(':chatId/attachments')
    @Role([RoleEnum.ALL])
    @UseGuards(IsBanMember)
    @UseInterceptors(UploadFileInterceptor)
    async upload(
        @UploadedFiles()
        uploaded:
            | { files?: Express.Multer.File[]; file?: Express.Multer.File[] }
            | undefined,
        @Param('chatId', ParseIntPipe) chatId: ChatId,
        @Body('voice') voice: string | undefined,
        @Req() req: RequestAuth,
    ): Promise<{ ok: true; data: StoredAttachment[] }> {
        const files = [...(uploaded?.files ?? []), ...(uploaded?.file ?? [])];
        // Read AFTER multer finished: a `voice` text part placed after the
        // file part is still exposed here (it is not visible in callbacks).
        const data = await this.attachmentService.uploadMany(
            files,
            chatId,
            req.user,
            voice === '1',
        );
        return { ok: true, data };
    }
}

/** Authorized download/preview of a single attachment, by database id only. */
@Controller('attachments')
export class AttachmentsController {
    constructor(private readonly attachmentService: AttachmentService) {}

    /**
     * Range-capable file/video stream. This route is `@Public` only because a
     * video player may present a signed `exp/uid/sig` URL instead of a bearer
     * header; the method guard enforces one of the two and the service still
     * re-checks membership, ban state and message deletion.
     */
    @Get(':id/download')
    @IsPublic()
    @UseGuards(AttachmentDownloadAuthGuard)
    async download(
        @Param('id', ParseIntPipe) id: AttachmentId,
        @Query('download') download: string | undefined,
        @Req() req: RequestAuth,
        @Res() res: Response,
    ) {
        await this.attachmentService.download(
            id,
            req.user,
            req as unknown as Request,
            res,
            download === '1' || download === 'true',
        );
    }

    @Get(':id/preview')
    @Role([RoleEnum.ALL])
    async preview(
        @Param('id', ParseIntPipe) id: AttachmentId,
        @Query('size') size: string | undefined,
        @Req() req: RequestAuth,
        @Res() res: Response,
    ) {
        await this.attachmentService.preview(
            id,
            size,
            req.user,
            req as unknown as Request,
            res,
        );
    }

    /** Short-lived signed URL for the video player (videos only). */
    @Post(':id/stream-url')
    @Role([RoleEnum.ALL])
    async streamUrl(
        @Param('id', ParseIntPipe) id: AttachmentId,
        @Req() req: RequestAuth,
    ): Promise<{ ok: true; data: { url: string; expiresAt: string } }> {
        const data = await this.attachmentService.createStreamUrl(
            id,
            req.user,
            req as unknown as Request,
        );
        return { ok: true, data };
    }
}
