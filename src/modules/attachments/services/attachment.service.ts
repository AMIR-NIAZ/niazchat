import {
    BadRequestException,
    HttpException,
    HttpStatus,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    PayloadTooLargeException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, Repository } from 'typeorm';
import { Request, Response } from 'express';
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import sharp from 'sharp';
import { Attachment } from '../entities/attachment.entity';
import { AttachmentConfig } from '../attachment.config';
import {
    extensionOf,
    isBlockedExtension,
    MIME_BY_EXT,
    sanitizeOriginalName,
} from '../utils/file-signature.util';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { AttachmentId, ChatId } from 'src/common/types/brands.type';
import { AttachmentStatus } from '../enums/attachmentStatus.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import {
    ATTACHMENT_CACHE_CONTROL,
    ATTACHMENT_PREVIEW_SIZES,
    AttachmentPreviewSize,
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_ATTACHMENT_MESSAGE_SIZE,
    MAX_CONCURRENT_UPLOADS_PER_USER,
    MAX_VIDEO_FILE_SIZE,
    MAX_VOICE_FILE_SIZE,
    VIDEO_EXTENSIONS,
    VOICE_EXTENSIONS,
} from '../attachment.constants';
import { attachmentKindOf } from 'src/common/utils/attachment-kind.util';
import {
    MediaProcessorService,
    VideoValidationError,
    VoiceValidationError,
} from './media-processor.service';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const VIDEO_EXTENSION_SET = new Set(VIDEO_EXTENSIONS);
const VOICE_EXTENSION_SET = new Set(VOICE_EXTENSIONS);

export interface StoredAttachment {
    id: number;
    originalName: string;
    mimeType: string;
    size: number;
    kind: 'image' | 'video' | 'voice' | 'file';
    width?: number;
    height?: number;
    duration?: number;
    hasPoster?: boolean;
    waveform?: number[];
}

interface PreparedFile {
    tempPath: string;
    originalName: string;
    extension: string;
    mimeType: string;
    kind: 'image' | 'video' | 'voice' | 'file';
    storageKey: string;
    width?: number;
    height?: number;
    duration?: number;
    voice?: boolean;
    waveform?: number[] | null;
}

@Injectable()
export class AttachmentService {
    private readonly logger = new Logger(AttachmentService.name);
    /** In-flight upload requests per user (small in-memory guard, no deps). */
    private readonly activeUploads = new Map<number, number>();
    private readonly previewJobs = new Map<string, Promise<void>>();

    constructor(
        @InjectRepository(Attachment)
        private readonly attachmentRepository: Repository<Attachment>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(Chat)
        private readonly chatRepository: Repository<Chat>,
        private readonly config: AttachmentConfig,
        private readonly media: MediaProcessorService,
    ) {}

    /**
     * Validates and stores one or more multipart files for a chat the user can
     * post in (membership/ban checks are done by the IsBanMember guard). Rows
     * are written only after every file passed validation; any failure removes
     * the files already written so no orphans remain.
     */
    async uploadMany(
        files: Express.Multer.File[],
        chatId: ChatId,
        user: JwtPayload,
        voiceRequested = false,
    ): Promise<StoredAttachment[]> {
        if (!files || files.length === 0) {
            throw new BadRequestException('file is required');
        }
        // Decided here, never in a multer callback: `voice` may arrive after
        // the file part and is only complete once the request body is read.
        if (voiceRequested && files.length !== 1) {
            throw new BadRequestException(
                'a voice message must contain exactly one file',
            );
        }
        if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
            throw new BadRequestException(
                `at most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`,
            );
        }

        const chat = await this.chatRepository.findOne({
            where: { id: chatId },
            select: { id: true, isBan: true },
        });
        if (!chat) {
            throw new BadRequestException('chat not found');
        }
        if (chat.isBan) {
            throw new BadRequestException('chat is banned');
        }

        const active = this.activeUploads.get(user.sub) ?? 0;
        if (active >= MAX_CONCURRENT_UPLOADS_PER_USER) {
            throw new HttpException(
                'too many uploads in progress, try again in a moment',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        this.activeUploads.set(user.sub, active + 1);

        const tempPaths = new Set<string>();
        const finalPaths = new Set<string>();
        try {
            const total = files.reduce((sum, file) => sum + file.size, 0);
            if (total > MAX_ATTACHMENT_MESSAGE_SIZE) {
                throw new PayloadTooLargeException(
                    `files exceed the maximum message size of ${MAX_ATTACHMENT_MESSAGE_SIZE} bytes`,
                );
            }

            const prepared: PreparedFile[] = [];
            for (const file of files) {
                const tempPath = await this.ensureTempPath(file);
                tempPaths.add(tempPath);
                prepared.push(
                    await this.prepareFile(
                        file,
                        tempPath,
                        chatId,
                        voiceRequested,
                    ),
                );
            }

            await fs.mkdir(this.config.storageDir, { recursive: true });
            for (const item of prepared) {
                const storagePath = this.storagePath(item.storageKey);
                await fs.mkdir(path.dirname(storagePath), { recursive: true });
                await fs.rename(item.tempPath, storagePath);
                tempPaths.delete(item.tempPath);
                finalPaths.add(storagePath);
            }

            // Poster failure never rejects the video: it is accepted without a
            // poster and the app renders its placeholder tile.
            const posterPaths = new Map<number, string>();
            for (let index = 0; index < prepared.length; index += 1) {
                const item = prepared[index];
                if (item.kind !== 'video' || item.duration === undefined) {
                    continue;
                }
                const posterKey = `${chatId}/${crypto.randomUUID()}.poster.webp`;
                const posterAbs = this.storagePath(posterKey);
                const ok = await this.media.generatePoster(
                    this.storagePath(item.storageKey),
                    posterAbs,
                    item.duration,
                );
                if (ok) {
                    posterPaths.set(index, posterKey);
                    finalPaths.add(posterAbs);
                }
            }

            let saved: Attachment[];
            try {
                saved = await this.attachmentRepository.save(
                    prepared.map((item, index) => ({
                        originalName: item.originalName,
                        storageKey: item.storageKey,
                        mimeType: item.mimeType,
                        size: this.sizeOf(item),
                        uploader: { id: user.sub },
                        chat: { id: chatId },
                        status: AttachmentStatus.PENDING,
                        width: item.width ?? null,
                        height: item.height ?? null,
                        duration:
                            item.duration === undefined
                                ? null
                                : item.duration.toFixed(1),
                        posterPath: posterPaths.get(index) ?? null,
                        voice: item.voice === true ? true : null,
                        waveform:
                            item.voice === true
                                ? (item.waveform ?? null)
                                : null,
                    })),
                );
            } catch (error) {
                this.logger.error(
                    `failed to persist attachment metadata: ${error}`,
                );
                throw new InternalServerErrorException(
                    'failed to save attachment',
                );
            }

            return saved.map((row, index) => {
                const file = prepared[index];
                return {
                    id: Number(row.id),
                    originalName: row.originalName,
                    mimeType: row.mimeType,
                    size: Number(row.size),
                    kind: file.kind,
                    ...(file.width !== undefined
                        ? { width: file.width, height: file.height }
                        : {}),
                    ...(file.kind === 'video'
                        ? {
                              duration: file.duration,
                              hasPoster: posterPaths.has(index),
                          }
                        : {}),
                    ...(file.kind === 'voice' && file.waveform != null
                        ? { waveform: file.waveform }
                        : {}),
                    ...(file.kind === 'voice'
                        ? { duration: file.duration }
                        : {}),
                };
            });
        } catch (error) {
            // Compensating cleanup: a failed validation/insert must not leave
            // files or poster files behind.
            await Promise.all(
                [...finalPaths].map((file) => removeQuietly(file)),
            );
            throw error;
        } finally {
            await Promise.all(
                [...tempPaths].map((file) => removeQuietly(file)),
            );
            const remaining = (this.activeUploads.get(user.sub) ?? 1) - 1;
            if (remaining <= 0) {
                this.activeUploads.delete(user.sub);
            } else {
                this.activeUploads.set(user.sub, remaining);
            }
        }
    }

    /** Single-file compatibility wrapper used by older callers/tests. */
    async upload(
        file: Express.Multer.File,
        chatId: ChatId,
        user: JwtPayload,
    ): Promise<StoredAttachment> {
        const [stored] = await this.uploadMany([file], chatId, user);
        if (stored === undefined) {
            throw new BadRequestException('file is required');
        }
        return stored;
    }

    private sizeOf(item: PreparedFile): number {
        return fsSync.statSync(this.storagePath(item.storageKey)).size;
    }

    /** Multer always provides a disk path; keep buffer-only callers working. */
    private async ensureTempPath(file: Express.Multer.File): Promise<string> {
        if (typeof file.path === 'string' && file.path !== '') {
            return file.path;
        }
        if (!file.buffer || file.buffer.length === 0) {
            throw new BadRequestException('file is required');
        }
        const dir = path.join(
            this.config.storageDir,
            '.incoming',
            crypto.randomUUID(),
        );
        await fs.mkdir(dir, { recursive: true });
        const tempPath = path.join(dir, `${crypto.randomUUID()}.part`);
        await fs.writeFile(tempPath, file.buffer, { flag: 'wx' });
        return tempPath;
    }

    private async prepareFile(
        file: Express.Multer.File,
        tempPath: string,
        chatId: ChatId,
        voiceRequested: boolean,
    ): Promise<PreparedFile> {
        const stat = await fs.stat(tempPath);
        // `file.size` is authoritative for the multipart body; the temp file
        // matches it for disk uploads and keeps buffer-only callers testable.
        const size = Math.max(stat.size, Number(file.size) || 0);
        if (size === 0) {
            throw new BadRequestException('file is required');
        }
        // Multer's per-file ceiling is the video limit; anything larger can
        // never be a valid attachment of any kind.
        if (stat.size > this.config.maxVideoFileSize) {
            throw new PayloadTooLargeException(
                `file exceeds the maximum allowed size of ${MAX_VIDEO_FILE_SIZE} bytes`,
            );
        }

        const originalName = sanitizeOriginalName(file.originalname);
        const extension = extensionOf(originalName);

        if (isBlockedExtension(originalName)) {
            throw new BadRequestException(
                `file type .${extension} is not allowed`,
            );
        }
        if (extension === '' || !this.config.isExtensionAllowed(extension)) {
            throw new BadRequestException(
                `file type${extension ? ` .${extension}` : ''} is not allowed`,
            );
        }

        const uuid = crypto.randomUUID();
        const storageKey = `${chatId}/${uuid}.${extension}`;

        if (voiceRequested) {
            return this.prepareVoice(
                tempPath,
                originalName,
                extension,
                storageKey,
                size,
            );
        }

        if (IMAGE_EXTENSIONS.includes(extension)) {
            // The ONLY way a file becomes an image: sharp decodes real pixels.
            let metadata: sharp.Metadata;
            try {
                metadata = await sharp(tempPath, {
                    limitInputPixels: 40_000_000,
                    failOn: 'error',
                }).metadata();
            } catch {
                throw new BadRequestException(
                    'file content is not a valid image',
                );
            }
            const mimeType = imageMimeOf(metadata.format);
            if (
                mimeType === null ||
                metadata.width === undefined ||
                metadata.height === undefined
            ) {
                throw new BadRequestException(
                    'file content is not a valid image',
                );
            }
            if (size > this.config.maxFileSize) {
                throw new PayloadTooLargeException(
                    `image exceeds the maximum allowed size of ${this.config.maxFileSize} bytes`,
                );
            }
            return {
                tempPath,
                originalName,
                extension,
                mimeType,
                kind: 'image',
                storageKey,
                width: metadata.width,
                height: metadata.height,
            };
        }

        if (VIDEO_EXTENSION_SET.has(extension)) {
            if (!this.media.isAvailable) {
                throw new ServiceUnavailableException(
                    'Video processing is unavailable',
                );
            }

            let probe:
                | { video: false }
                | {
                      video: true;
                      result: {
                          mimeType: string;
                          width: number;
                          height: number;
                          duration: number;
                      };
                  }
                | null;
            try {
                probe = await this.media.probe(tempPath, extension);
            } catch (error) {
                if (error instanceof VideoValidationError) {
                    throw new BadRequestException(error.message);
                }
                throw error;
            }
            if (probe === null) {
                throw new BadRequestException('This file is not a valid video');
            }

            if (probe.video) {
                if (size > this.config.maxVideoFileSize) {
                    throw new PayloadTooLargeException(
                        `video exceeds the maximum allowed size of ${MAX_VIDEO_FILE_SIZE} bytes`,
                    );
                }
                return {
                    tempPath,
                    originalName,
                    extension,
                    mimeType: probe.result.mimeType,
                    kind: 'video',
                    storageKey,
                    width: probe.result.width,
                    height: probe.result.height,
                    duration: probe.result.duration,
                };
            }
            // Audio-only files (including cover art) and unsupported
            // containers stay regular files.
        }

        if (size > this.config.maxFileSize) {
            throw new PayloadTooLargeException(
                `file exceeds the maximum allowed size of ${this.config.maxFileSize} bytes`,
            );
        }

        // Non-image/video types are never rendered inline and are served as
        // application/octet-stream, so their content cannot execute.
        return {
            tempPath,
            originalName,
            extension,
            mimeType: MIME_BY_EXT[extension] ?? 'application/octet-stream',
            kind: 'file',
            storageKey,
        };
    }

    /**
     * Voice upload path (`voice=1`). The container/codec is verified with
     * ffprobe and the waveform is generated from streamed PCM; a waveform
     * failure never rejects the recording (it is stored with NULL bars).
     */
    private async prepareVoice(
        tempPath: string,
        originalName: string,
        extension: string,
        storageKey: string,
        size: number,
    ): Promise<PreparedFile> {
        if (!this.media.isAvailable) {
            throw new ServiceUnavailableException(
                'Audio processing is unavailable',
            );
        }
        if (!VOICE_EXTENSION_SET.has(extension)) {
            throw new BadRequestException(
                'This file is not a valid voice recording',
            );
        }
        if (size > MAX_VOICE_FILE_SIZE) {
            throw new PayloadTooLargeException(
                `voice message exceeds the maximum allowed size of ${MAX_VOICE_FILE_SIZE} bytes`,
            );
        }

        let probe: { mimeType: string; duration: number } | null;
        try {
            probe = await this.media.probeAudio(tempPath);
        } catch (error) {
            if (error instanceof VoiceValidationError) {
                throw new BadRequestException(error.message);
            }
            throw error;
        }
        if (probe === null) {
            throw new BadRequestException(
                'This file is not a valid voice recording',
            );
        }

        const waveform = await this.media.generateWaveform(tempPath);
        if (waveform === null) {
            this.logger.warn(
                `voice waveform unavailable for ${originalName}; storing NULL bars`,
            );
        }

        return {
            tempPath,
            originalName,
            extension,
            mimeType: probe.mimeType,
            kind: 'voice',
            storageKey,
            duration: probe.duration,
            voice: true,
            waveform,
        };
    }

    /**
     * Streams an attachment after authorization. Content is located through
     * the DB row only; internal filesystem paths stay server-side.
     */
    async download(
        id: AttachmentId,
        user: JwtPayload,
        req: Request,
        res: Response,
        forceDownload = false,
    ): Promise<void> {
        const attachment = await this.loadReadable(id, user);
        const storagePath = this.storagePath(attachment.storageKey);
        if (!fsSync.existsSync(storagePath)) {
            throw new NotFoundException('attachment not found');
        }

        const kind = attachmentKindOf(attachment.mimeType, attachment.voice);
        const isVideo = kind === 'video';
        const isVoice = kind === 'voice';
        await this.streamFile(req, res, storagePath, {
            contentType:
                kind === 'file'
                    ? 'application/octet-stream'
                    : attachment.mimeType,
            dispositionName: attachment.originalName,
            inline: isVoice || (isVideo ? !forceDownload : kind === 'image'),
            allowRanges: true,
        });
    }

    /**
     * On-demand resized WebP preview of an image, or the stored poster of a
     * video (disk cached, deduplicated, written atomically).
     */
    async preview(
        id: AttachmentId,
        rawSize: string | undefined,
        user: JwtPayload,
        req: Request,
        res: Response,
    ): Promise<void> {
        const attachment = await this.loadReadable(id, user);
        const kind = attachmentKindOf(attachment.mimeType, attachment.voice);

        if (kind === 'video') {
            await this.videoPosterPreview(attachment, rawSize, req, res);
            return;
        }
        if (kind !== 'image') {
            throw new BadRequestException(
                'preview is only available for images and videos',
            );
        }

        const size = this.parsePreviewSize(rawSize);
        const original = this.storagePath(attachment.storageKey);
        if (!fsSync.existsSync(original)) {
            throw new NotFoundException('attachment not found');
        }

        // Animated GIFs lose their animation when re-encoded; serve as-is.
        const metadata = await sharp(original, {
            limitInputPixels: 40_000_000,
            failOn: 'error',
        }).metadata();
        if ((metadata.pages ?? 1) > 1) {
            await this.streamFile(req, res, original, {
                contentType: 'image/gif',
                dispositionName: attachment.originalName,
                inline: true,
                allowRanges: true,
            });
            return;
        }

        const cachePath = path.join(
            this.config.previewDir,
            String(size),
            `${attachment.storageKey}.webp`,
        );
        if (!fsSync.existsSync(cachePath)) {
            const key = `${size}/${attachment.storageKey}`;
            let job = this.previewJobs.get(key);
            if (job === undefined) {
                job = this.generatePreview(original, cachePath, size).finally(
                    (): void => {
                        this.previewJobs.delete(key);
                    },
                );
                this.previewJobs.set(key, job);
            }
            await job;
        }

        await this.streamFile(req, res, cachePath, {
            contentType: 'image/webp',
            dispositionName: attachment.originalName,
            inline: true,
            allowRanges: false,
        });
    }

    private async videoPosterPreview(
        attachment: Attachment,
        rawSize: string | undefined,
        req: Request,
        res: Response,
    ): Promise<void> {
        if (!attachment.posterPath) {
            throw new NotFoundException('preview not found');
        }
        const poster = this.storagePath(attachment.posterPath);
        if (!fsSync.existsSync(poster)) {
            throw new NotFoundException('preview not found');
        }
        const size = this.parsePreviewSize(rawSize);
        const cachePath = path.join(
            this.config.previewDir,
            String(size),
            `${attachment.storageKey}.poster.webp`,
        );
        if (!fsSync.existsSync(cachePath)) {
            const key = `${size}/${attachment.storageKey}.poster`;
            let job = this.previewJobs.get(key);
            if (job === undefined) {
                job = this.generatePreview(poster, cachePath, size).finally(
                    (): void => {
                        this.previewJobs.delete(key);
                    },
                );
                this.previewJobs.set(key, job);
            }
            await job;
        }
        await this.streamFile(req, res, cachePath, {
            contentType: 'image/webp',
            dispositionName: attachment.originalName,
            inline: true,
            allowRanges: false,
        });
    }

    private parsePreviewSize(raw: string | undefined): AttachmentPreviewSize {
        if (raw === undefined || raw === '') {
            return this.config.previewSize as AttachmentPreviewSize;
        }
        const parsed = Number(raw);
        if (
            !/^\d+$/.test(raw) ||
            !(ATTACHMENT_PREVIEW_SIZES as readonly number[]).includes(parsed)
        ) {
            throw new BadRequestException(
                `size must be one of ${ATTACHMENT_PREVIEW_SIZES.join(', ')}`,
            );
        }
        return parsed as AttachmentPreviewSize;
    }

    private async generatePreview(
        original: string,
        target: string,
        size: AttachmentPreviewSize,
    ): Promise<void> {
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = path.join(
            path.dirname(target),
            `${process.pid}-${crypto.randomUUID()}.tmp`,
        );
        try {
            await sharp(original, {
                limitInputPixels: 40_000_000,
                failOn: 'error',
            })
                .rotate()
                .resize({
                    width: size,
                    height: size,
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .webp({ quality: 82 })
                .toFile(temporary);
            await fs.rename(temporary, target);
        } catch (error) {
            await removeQuietly(temporary);
            this.logger.warn(
                `attachment preview generation failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            throw new BadRequestException('could not process this image');
        }
    }

    /**
     * Short-lived signed URL for a video. The HMAC binds attachment id, user id
     * and expiry; the access token is never placed in a URL.
     */
    async createStreamUrl(
        id: AttachmentId,
        user: JwtPayload,
        req: Request,
    ): Promise<{ url: string; expiresAt: string }> {
        const attachment = await this.loadReadable(id, user);
        if (
            attachmentKindOf(attachment.mimeType, attachment.voice) !== 'video'
        ) {
            throw new BadRequestException('only videos can be streamed');
        }

        const expiresAt = Math.floor(
            (Date.now() + this.config.streamUrlTtlMs) / 1000,
        );
        const userId = Number(user.sub);
        const sig = this.signStream(id, userId, expiresAt);
        const host = req.get('host') ?? 'localhost';
        const base = `${req.protocol}://${host}`;
        return {
            url: `${base}/attachments/${Number(id)}/download?uid=${userId}&exp=${expiresAt}&sig=${sig}`,
            expiresAt: new Date(expiresAt * 1000).toISOString(),
        };
    }

    /** Verifies a signed stream URL and returns the bound user id, or null. */
    resolveStreamSignature(
        id: number,
        uidRaw: string,
        expRaw: string,
        sigRaw: string,
    ): number | null {
        const uid = Number(uidRaw);
        const exp = Number(expRaw);
        if (
            !Number.isInteger(uid) ||
            uid <= 0 ||
            !Number.isInteger(exp) ||
            exp * 1000 <= Date.now()
        ) {
            return null;
        }
        const expected = this.signStream(id, uid, exp);
        const expectedBuffer = Buffer.from(expected, 'utf8');
        const givenBuffer = Buffer.from(sigRaw, 'utf8');
        if (expectedBuffer.length !== givenBuffer.length) {
            return null;
        }
        return crypto.timingSafeEqual(expectedBuffer, givenBuffer) ? uid : null;
    }

    private signStream(id: number, userId: number, exp: number): string {
        return crypto
            .createHmac('sha256', this.config.streamSecret)
            .update(`${id}:${userId}:${exp}`)
            .digest('hex');
    }

    /**
     * Loads an attachment and enforces read access. Every failure — missing,
     * foreign, banned, deleted message, banned chat — is a 404 so existence is
     * not leaked.
     */
    private async loadReadable(
        id: AttachmentId,
        user: JwtPayload,
    ): Promise<Attachment> {
        const attachment = await this.attachmentRepository.findOne({
            where: { id },
            relations: { chat: true, uploader: true, message: true },
        });
        if (!attachment) throw new NotFoundException('attachment not found');

        if (attachment.status !== AttachmentStatus.ATTACHED) {
            // Unsent attachments are private to their uploader.
            if (Number(attachment.uploader?.id) !== Number(user.sub)) {
                throw new NotFoundException('attachment not found');
            }
            return attachment;
        }

        if (attachment.message?.isDeleted === true) {
            throw new NotFoundException('attachment not found');
        }
        if (attachment.chat?.isBan === true) {
            throw new NotFoundException('attachment not found');
        }

        const membership = await this.memberRepository.findOne({
            where: {
                chat: { id: attachment.chat.id },
                user: { id: user.sub },
            },
            relations: { role: true },
        });
        if (
            !membership ||
            membership.role?.name === (RoleChatEnum.BAN as string)
        ) {
            throw new NotFoundException('attachment not found');
        }
        return attachment;
    }

    /**
     * Sends a stored file with the project's attachment headers: RFC 5987
     * filename, nosniff, immutable private cache, ETag/Last-Modified with 304.
     *
     * Range support: single `bytes=a-b`, open-ended `bytes=a-` and suffix
     * `bytes=-n` answer 206; unsatisfiable/invalid ranges answer 416;
     * multi-range requests are ignored (full 200); If-Range mismatches also
     * fall back to the full 200. Streams are destroyed on client disconnect.
     */
    private async streamFile(
        req: Request,
        res: Response,
        filePath: string,
        options: {
            contentType: string;
            dispositionName: string;
            inline: boolean;
            allowRanges: boolean;
        },
    ): Promise<void> {
        const stat = await fs.stat(filePath);
        const etag = `"${stat.size.toString(16)}-${Math.floor(
            stat.mtimeMs,
        ).toString(16)}"`;

        res.setHeader('Content-Type', options.contentType);
        res.setHeader(
            'Content-Disposition',
            contentDisposition(options.dispositionName, options.inline),
        );
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', ATTACHMENT_CACHE_CONTROL);
        res.setHeader('ETag', etag);
        res.setHeader('Last-Modified', stat.mtime.toUTCString());
        if (options.allowRanges) {
            res.setHeader('Accept-Ranges', 'bytes');
        }

        if (isNotModified(req, etag, stat.mtime)) {
            res.status(304).end();
            return;
        }

        let allowRange = options.allowRanges;
        const ifRange = req.headers['if-range'];
        if (
            typeof ifRange === 'string' &&
            !ifRangeMatches(ifRange, etag, stat.mtime)
        ) {
            allowRange = false;
        }

        const rangeHeader =
            allowRange && typeof req.headers.range === 'string'
                ? req.headers.range.trim()
                : null;
        // Multiple ranges are ignored: answer the complete representation.
        const range =
            rangeHeader === null || rangeHeader.includes(',')
                ? null
                : parseRangeHeader(rangeHeader, stat.size);

        if (range === 'invalid') {
            res.setHeader('Content-Range', `bytes */${stat.size}`);
            res.status(416).end();
            return;
        }

        if (range !== null) {
            const length = range.end - range.start + 1;
            res.status(206);
            res.setHeader(
                'Content-Range',
                `bytes ${range.start}-${range.end}/${stat.size}`,
            );
            res.setHeader('Content-Length', String(length));
            this.pipeFile(req, res, filePath, range.start, range.end);
            return;
        }

        res.setHeader('Content-Length', String(stat.size));
        res.status(200);
        this.pipeFile(req, res, filePath);
    }

    private pipeFile(
        req: Request,
        res: Response,
        filePath: string,
        start?: number,
        end?: number,
    ): void {
        const stream = fsSync.createReadStream(
            filePath,
            start !== undefined && end !== undefined ? { start, end } : {},
        );
        const destroy = (): void => {
            stream.destroy();
        };
        res.once('close', destroy);
        req.once('aborted', destroy);
        stream.once('close', () => {
            res.off('close', destroy);
            req.off('aborted', destroy);
        });
        stream.once('error', () => {
            res.destroy();
        });
        stream.pipe(res);
    }

    /**
     * Validates that every attachment id may be used by this sender for a
     * message in this chat and that the message fits the size cap. Throws on
     * any failure.
     */
    async findUsable(
        attachmentIds: AttachmentId[],
        userId: number,
        chatId: ChatId,
    ): Promise<Attachment[]> {
        const attachments = await this.attachmentRepository.find({
            where: { id: In(attachmentIds) },
            relations: { uploader: true, chat: true },
        });
        if (attachments.length !== attachmentIds.length) {
            throw new BadRequestException('attachment not found');
        }

        const byId = new Map(attachments.map((a) => [Number(a.id), a]));
        let total = 0;
        for (const id of attachmentIds) {
            const attachment = byId.get(Number(id));
            if (attachment === undefined) {
                throw new BadRequestException('attachment not found');
            }
            if (Number(attachment.uploader?.id) !== Number(userId)) {
                throw new BadRequestException(
                    'attachment was not uploaded by this user',
                );
            }
            if (Number(attachment.chat?.id) !== Number(chatId)) {
                throw new BadRequestException(
                    'attachment does not belong to this chat',
                );
            }
            if (attachment.status !== AttachmentStatus.PENDING) {
                throw new BadRequestException('attachment already used');
            }
            total += Number(attachment.size);
        }
        if (total > MAX_ATTACHMENT_MESSAGE_SIZE) {
            throw new BadRequestException(
                `attachments exceed the maximum message size of ${MAX_ATTACHMENT_MESSAGE_SIZE} bytes`,
            );
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

    /** Deletes an attachment file, its poster and cached previews. Never throws. */
    async deleteFile(
        storageKey: string,
        posterPath?: string | null,
    ): Promise<void> {
        const storagePath = this.storagePath(storageKey);
        if (storagePath !== '') {
            await removeQuietly(storagePath);
        }
        if (posterPath) {
            const poster = this.storagePath(posterPath);
            if (poster !== '') {
                await removeQuietly(poster);
            }
        }
        await Promise.all(
            ATTACHMENT_PREVIEW_SIZES.flatMap((size) => [
                removeQuietly(
                    path.join(
                        this.config.previewDir,
                        String(size),
                        `${storageKey}.webp`,
                    ),
                ),
                removeQuietly(
                    path.join(
                        this.config.previewDir,
                        String(size),
                        `${storageKey}.poster.webp`,
                    ),
                ),
            ]),
        );
    }

    /**
     * Creates an independent copy of an attachment's file (and poster) under
     * the target chat, with a fresh random name. Hard links are used when the
     * source and target live on the same filesystem; copyFile is the fallback.
     * The caller owns the returned keys and must remove them on rollback.
     */
    async copyFilesForForward(
        source: Pick<Attachment, 'storageKey' | 'posterPath'>,
        targetChatId: ChatId,
    ): Promise<{ storageKey: string; posterPath: string | null }> {
        const sourcePath = this.storagePath(source.storageKey);
        if (
            sourcePath === '' ||
            !fsSync.existsSync(sourcePath) ||
            !fsSync.statSync(sourcePath).isFile()
        ) {
            throw new BadRequestException(
                'An attachment is no longer available',
            );
        }

        const extension = path.extname(source.storageKey);
        const storageKey = `${targetChatId}/${crypto.randomUUID()}${extension}`;
        const targetPath = this.storagePath(storageKey);
        if (targetPath === '') {
            throw new BadRequestException(
                'An attachment is no longer available',
            );
        }

        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await this.linkOrCopy(sourcePath, targetPath);

        let posterPath: string | null = null;
        if (source.posterPath) {
            const sourcePoster = this.storagePath(source.posterPath);
            if (
                sourcePoster === '' ||
                !fsSync.existsSync(sourcePoster) ||
                !fsSync.statSync(sourcePoster).isFile()
            ) {
                await removeQuietly(targetPath);
                throw new BadRequestException(
                    'An attachment is no longer available',
                );
            }
            posterPath = `${targetChatId}/${crypto.randomUUID()}.poster.webp`;
            const targetPoster = this.storagePath(posterPath);
            try {
                await fs.mkdir(path.dirname(targetPoster), { recursive: true });
                await this.linkOrCopy(sourcePoster, targetPoster);
            } catch (error) {
                await removeQuietly(targetPath);
                throw error;
            }
        }

        return { storageKey, posterPath };
    }

    private async linkOrCopy(source: string, target: string): Promise<void> {
        try {
            await fs.link(source, target);
        } catch {
            await fs.copyFile(source, target);
        }
    }

    /** Removes unsent uploads older than the configured TTL. */
    async cleanupOrphans(now: Date = new Date()): Promise<number> {
        const cutoff = new Date(now.getTime() - this.config.orphanTtlMs);
        const rows = await this.attachmentRepository.find({
            where: {
                status: AttachmentStatus.PENDING,
                createdAt: LessThan(cutoff),
            },
            select: { id: true, storageKey: true, posterPath: true },
        });
        let removed = 0;
        for (const row of rows) {
            await this.deleteFile(row.storageKey, row.posterPath);
            await this.attachmentRepository.delete(row.id);
            removed += 1;
        }
        return removed;
    }

    /** Removes files of messages soft-deleted longer than the configured TTL. */
    async cleanupDeletedMessageAttachments(
        now: Date = new Date(),
    ): Promise<number> {
        const cutoff = new Date(now.getTime() - this.config.deletedTtlMs);
        const rows = await this.attachmentRepository
            .createQueryBuilder('attachment')
            .innerJoin('attachment.message', 'message')
            .where('message.isDeleted = true')
            .andWhere('message.updatedAt < :cutoff', { cutoff })
            .select([
                'attachment.id',
                'attachment.storageKey',
                'attachment.posterPath',
            ])
            .getMany();

        let removed = 0;
        for (const row of rows) {
            await this.deleteFile(row.storageKey, row.posterPath);
            await this.attachmentRepository.delete(row.id);
            removed += 1;
        }
        return removed;
    }

    private storagePath(storageKey: string): string {
        if (
            !storageKey ||
            storageKey.includes('..') ||
            path.isAbsolute(storageKey)
        ) {
            return '';
        }
        const resolved = path.resolve(this.config.storageDir, storageKey);
        const root = this.config.storageDir.endsWith(path.sep)
            ? this.config.storageDir
            : this.config.storageDir + path.sep;
        return resolved.startsWith(root) ? resolved : '';
    }
}

function imageMimeOf(format: string | undefined): string | null {
    switch (format) {
        case 'jpeg':
            return 'image/jpeg';
        case 'png':
            return 'image/png';
        case 'webp':
            return 'image/webp';
        case 'gif':
            return 'image/gif';
        default:
            return null;
    }
}

async function removeQuietly(filePath: string): Promise<void> {
    if (!filePath) return;
    await fs.rm(filePath, { force: true }).catch((): void => undefined);
}

/**
 * `Content-Disposition` with an ASCII fallback plus an RFC 5987 UTF-8 name, so
 * Persian file names survive both old and modern clients.
 */
export function contentDisposition(
    originalName: string,
    inline: boolean,
): string {
    const utf8 = encodeURIComponent(originalName).replace(/'/g, '%27');
    const ascii =
        originalName
            .replace(/[^\x20-\x7e]/g, '_')
            .replace(/["\\]/g, '_')
            .trim() || 'file';
    const type = inline ? 'inline' : 'attachment';
    return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

function isNotModified(req: Request, etag: string, mtime: Date): boolean {
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string') {
        return ifNoneMatch
            .split(',')
            .map((value) => value.trim())
            .some((value) => value === etag || value === '*');
    }
    if (req.headers['if-modified-since'] !== undefined) {
        const since = Date.parse(String(req.headers['if-modified-since']));
        return Number.isFinite(since) && mtime.getTime() <= since + 999;
    }
    return false;
}

/** `If-Range` must match the current ETag or Last-Modified to allow a 206. */
function ifRangeMatches(ifRange: string, etag: string, mtime: Date): boolean {
    const value = ifRange.trim();
    if (value.startsWith('"') || value.startsWith('W/')) {
        return value === etag;
    }
    const date = Date.parse(value);
    return (
        Number.isFinite(date) &&
        Math.floor(mtime.getTime() / 1000) <= Math.floor(date / 1000)
    );
}

function parseRangeHeader(
    header: string,
    size: number,
): { start: number; end: number } | 'invalid' | null {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (match === null) return 'invalid';
    const startText = match[1] ?? '';
    const endText = match[2] ?? '';
    if (startText === '' && endText === '') return 'invalid';

    if (startText === '') {
        const suffix = Number(endText);
        if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid';
        const start = Math.max(0, size - suffix);
        return { start, end: size - 1 };
    }

    const start = Number(startText);
    const end = endText === '' ? size - 1 : Number(endText);
    if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        start >= size
    ) {
        return 'invalid';
    }
    return { start, end: Math.min(end, size - 1) };
}
