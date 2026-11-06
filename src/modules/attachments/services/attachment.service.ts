import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Response } from 'express';
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Attachment } from '../entities/attachment.entity';
import { AttachmentConfig } from '../attachment.config';
import {
    detectFileMimeType,
    sanitizeOriginalName,
} from '../utils/file-signature.util';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { AttachmentId, ChatId } from 'src/common/types/brands.type';
import { AttachmentStatus } from '../enums/attachmentStatus.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';

@Injectable()
export class AttachmentService {
    private readonly logger = new Logger(AttachmentService.name);

    constructor(
        @InjectRepository(Attachment)
        private readonly attachmentRepository: Repository<Attachment>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        private readonly config: AttachmentConfig,
    ) {}

    /**
     * Validates and stores an uploaded file for a chat the user can post in
     * (membership/ban checks are done by the IsBanMember guard). The file is
     * written and the metadata row inserted only after all checks pass; any
     * failure removes the already-written file so no orphans remain.
     */
    async upload(
        file: Express.Multer.File,
        chatId: ChatId,
        user: JwtPayload,
    ): Promise<Attachment> {
        if (!file || !file.buffer || file.buffer.length === 0) {
            throw new BadRequestException('file is required');
        }
        if (file.size > this.config.maxFileSize) {
            throw new BadRequestException(
                `file exceeds the maximum allowed size of ${this.config.maxFileSize} bytes`,
            );
        }

        // Never trust the client's declared type: the claimed MIME must be
        // allowlisted and must match what the actual bytes look like.
        const claimedMime = (file.mimetype ?? '').toLowerCase();
        if (!this.config.isMimeAllowed(claimedMime)) {
            throw new BadRequestException('file type is not allowed');
        }

        const detected = detectFileMimeType(file.buffer);
        if (detected && detected !== claimedMime) {
            throw new BadRequestException(
                'file content does not match its declared type',
            );
        }

        // Server-controlled storage key: uuid + extension derived from the
        // verified MIME type. The client filename is kept for display only.
        const ext = this.config.extensionForMime(claimedMime);
        const storageKey = `${crypto.randomUUID()}.${ext}`;

        await fs.mkdir(this.config.storageDir, { recursive: true });
        const storagePath = path.join(this.config.storageDir, storageKey);

        try {
            await fs.writeFile(storagePath, file.buffer);
        } catch (error) {
            this.logger.error(`failed to store uploaded file: ${error}`);
            throw new InternalServerErrorException('failed to store file');
        }

        try {
            return await this.attachmentRepository.save({
                originalName: sanitizeOriginalName(file.originalname),
                storageKey,
                mimeType: claimedMime,
                size: file.buffer.length,
                uploader: { id: user.sub },
                chat: { id: chatId },
                status: AttachmentStatus.PENDING,
            });
        } catch (error) {
            // Compensating cleanup: a failed insert must not leave the file on
            // disk without a database record.
            await fs.rm(storagePath, { force: true }).catch((cleanupError) => {
                this.logger.error(
                    `failed to clean up orphaned file ${storageKey}: ${cleanupError}`,
                );
            });
            this.logger.error(
                `failed to persist attachment metadata: ${error}`,
            );
            throw new InternalServerErrorException('failed to save attachment');
        }
    }

    /**
     * Streams an attachment to the response after authorization. Content is
     * located through the DB row only; internal filesystem paths stay
     * server-side and are never exposed.
     */
    async download(id: AttachmentId, user: JwtPayload, res: Response) {
        const attachment = await this.attachmentRepository.findOne({
            where: { id },
            relations: { chat: true, uploader: true },
        });
        if (!attachment) throw new NotFoundException('attachment not found');

        await this.assertReadableBy(attachment, user);

        const storagePath = path.join(
            this.config.storageDir,
            attachment.storageKey,
        );
        if (
            !storagePath.startsWith(this.config.storageDir + path.sep) ||
            !fsSync.existsSync(storagePath)
        ) {
            throw new InternalServerErrorException('file is unavailable');
        }

        // Safe headers: never render content inline and force a download
        // labeled with the sanitized display name, which neutralizes stored
        // HTML/SVG/JS payloads without trusting any client behaviour.
        res.setHeader('Content-Type', attachment.mimeType);
        res.setHeader('Content-Length', String(attachment.size));
        res.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${this.encodedName(attachment.originalName)}`,
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store');

        fsSync.createReadStream(storagePath).pipe(res);
    }

    private async assertReadableBy(attachment: Attachment, user: JwtPayload) {
        if (attachment.status !== AttachmentStatus.ATTACHED) {
            // Unsent attachments are private to their uploader.
            if (attachment.uploader.id !== user.sub) {
                throw new ForbiddenException('user not access');
            }
            return;
        }

        const membership = await this.memberRepository.findOne({
            where: {
                chat: { id: attachment.chat.id },
                user: { id: user.sub },
            },
            relations: { role: true },
        });
        if (!membership) throw new ForbiddenException('user not access');

        if (membership.role?.name === (RoleChatEnum.BAN as string)) {
            throw new ForbiddenException('user not access');
        }
    }

    private encodedName(originalName: string): string {
        return encodeURIComponent(originalName).replace(/'/g, '%27');
    }

    /**
     * Validates that every attachment id may be used by this sender for a
     * message in this chat. Throws on any failure.
     */
    async findUsable(
        attachmentIds: AttachmentId[],
        userId: number,
        chatId: ChatId,
    ): Promise<Attachment[]> {
        const attachments = await this.attachmentRepository.find({
            where: attachmentIds.map((id) => ({ id })),
            relations: { uploader: true, chat: true },
        });
        if (attachments.length !== attachmentIds.length) {
            throw new NotFoundException('attachment not found');
        }

        const byId = new Map(attachments.map((a) => [a.id as number, a]));
        for (const id of attachmentIds) {
            const attachment = byId.get(id as number)!;
            if (attachment.uploader.id !== userId) {
                throw new ForbiddenException('user not access');
            }
            if (attachment.chat.id !== chatId) {
                throw new BadRequestException(
                    'attachment does not belong to this chat',
                );
            }
            if (attachment.status !== AttachmentStatus.PENDING) {
                throw new BadRequestException('attachment already used');
            }
        }
        return attachments;
    }

    /**
     * Binds pending attachments to a created message. Must be called inside
     * the message-creation transaction so a failure rolls the message back
     * too; the conditional `status = 'pending'` guard makes concurrent reuse
     * impossible (the affected-row count is checked, not assumed).
     */
    async bindToMessage(
        manager: EntityManager,
        attachmentIds: AttachmentId[],
        messageId: number,
    ): Promise<void> {
        const result = await manager.getRepository(Attachment).update(
            { id: In(attachmentIds), status: AttachmentStatus.PENDING },
            {
                status: AttachmentStatus.ATTACHED,
                message: { id: messageId },
            },
        );

        if (result.affected !== attachmentIds.length) {
            throw new BadRequestException('attachment already used');
        }
    }

    /** Deletes an attachment file; used for compensating cleanup. */
    async deleteFile(storageKey: string): Promise<void> {
        if (
            !storageKey ||
            storageKey.includes('/') ||
            storageKey.includes('..')
        ) {
            return;
        }
        await fs
            .rm(path.join(this.config.storageDir, storageKey), { force: true })
            .catch((error) => {
                this.logger.error(
                    `failed to delete file ${storageKey}: ${error}`,
                );
            });
    }
}
