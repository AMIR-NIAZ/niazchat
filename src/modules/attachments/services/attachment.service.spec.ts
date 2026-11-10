import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
    InternalServerErrorException,
    NotFoundException,
    PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import { AttachmentService, contentDisposition } from './attachment.service';
import { VoiceValidationError } from './media-processor.service';
import { Attachment } from '../entities/attachment.entity';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { AttachmentConfig } from '../attachment.config';
import { MediaProcessorService } from './media-processor.service';
import { AttachmentStatus } from '../enums/attachmentStatus.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import {
    MAX_ATTACHMENT_FILE_SIZE,
    MAX_ATTACHMENT_MESSAGE_SIZE,
    MAX_VOICE_FILE_SIZE,
} from '../attachment.constants';

describe('AttachmentService', () => {
    let service: AttachmentService;
    let storageRoot: string;
    let config: AttachmentConfig;
    let png: Buffer;
    let attachmentRepository: {
        save: jest.Mock;
        findOne: jest.Mock;
        find: jest.Mock;
        delete: jest.Mock;
        createQueryBuilder: jest.Mock;
    };
    let memberRepository: { findOne: jest.Mock };
    let chatRepository: { findOne: jest.Mock };
    let media: {
        isAvailable: boolean;
        probe: jest.Mock;
        probeAudio: jest.Mock;
        generatePoster: jest.Mock;
        generateWaveform: jest.Mock;
    };

    const user = { sub: 1, role: 'user' } as never;
    const chatId = 10 as never;

    beforeAll(async () => {
        png = await sharp({
            create: {
                width: 40,
                height: 30,
                channels: 3,
                background: '#ff0000',
            },
        })
            .png()
            .toBuffer();
    });

    const file = (
        over: Partial<Express.Multer.File> = {},
    ): Express.Multer.File =>
        ({
            buffer: png,
            size: png.length,
            mimetype: 'image/png',
            originalname: 'photo.png',
            ...over,
        }) as Express.Multer.File;

    beforeEach(async () => {
        jest.clearAllMocks();
        storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'attachments-'));

        config = new AttachmentConfig({
            get: (key: string) => {
                const values: Record<string, string> = {
                    UPLOAD_MAX_FILE_SIZE: String(MAX_ATTACHMENT_FILE_SIZE),
                    STORAGE_DIR: storageRoot,
                    ATTACHMENT_ORPHAN_TTL_MS: '1000',
                };
                return values[key];
            },
        } as unknown as ConfigService);

        attachmentRepository = {
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
            createQueryBuilder: jest.fn(),
        };
        attachmentRepository.save.mockImplementation(
            (rows: Array<Record<string, unknown>>) =>
                rows.map((row, index) => ({ id: 100 + index, ...row })),
        );
        memberRepository = { findOne: jest.fn() };
        chatRepository = {
            findOne: jest.fn().mockResolvedValue({ id: 10, isBan: false }),
        };

        media = {
            isAvailable: false,
            probe: jest.fn(),
            probeAudio: jest.fn(),
            generatePoster: jest.fn().mockResolvedValue(false),
            generateWaveform: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AttachmentService,
                {
                    provide: getRepositoryToken(Attachment),
                    useValue: attachmentRepository,
                },
                {
                    provide: getRepositoryToken(ChatMember),
                    useValue: memberRepository,
                },
                {
                    provide: getRepositoryToken(Chat),
                    useValue: chatRepository,
                },
                { provide: AttachmentConfig, useValue: config },
                {
                    provide: MediaProcessorService,
                    useValue: media,
                },
            ],
        }).compile();

        service = module.get<AttachmentService>(AttachmentService);
    });

    afterEach(async () => {
        await fs.rm(storageRoot, { recursive: true, force: true });
    });

    describe('uploadMany', () => {
        it('stores an image and a document with server-generated names and verified kinds', async () => {
            const pdf = Buffer.from('%PDF-1.7\nhello\n');
            const result = await service.uploadMany(
                [
                    file(),
                    file({
                        buffer: pdf,
                        size: pdf.length,
                        mimetype: 'application/pdf',
                        originalname: 'report.pdf',
                    }),
                ],
                chatId,
                user,
            );

            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({
                id: 100,
                kind: 'image',
                mimeType: 'image/png',
                width: 40,
                height: 30,
            });
            expect(result[1]).toMatchObject({
                id: 101,
                kind: 'file',
                mimeType: 'application/pdf',
            });

            const saved = (
                attachmentRepository.save.mock.calls[0] as unknown as [
                    Array<{ storageKey: string }>,
                ]
            )[0];
            expect(saved[0]?.storageKey).toMatch(/^10\/[0-9a-f-]+\.png$/);
            expect(saved[1]?.storageKey).toMatch(/^10\/[0-9a-f-]+\.pdf$/);
            await expect(
                fs.access(path.join(config.storageDir, saved[0].storageKey)),
            ).resolves.toBeUndefined();
        });

        it('decodes a Persian file name that arrived as latin1 mojibake', async () => {
            const persian = 'گزارش تصویری.pdf';
            const mojibake = Buffer.from(persian, 'utf8').toString('latin1');
            const pdf = Buffer.from('%PDF-1.7\n');
            const [stored] = await service.uploadMany(
                [
                    file({
                        buffer: pdf,
                        size: pdf.length,
                        mimetype: 'application/pdf',
                        originalname: mojibake,
                    }),
                ],
                chatId,
                user,
            );

            expect(stored?.originalName).toBe(persian);
            const savedRows = (
                attachmentRepository.save.mock.calls[0] as unknown as [
                    Array<{ originalName: string }>,
                ]
            )[0];
            expect(savedRows[0]).toMatchObject({ originalName: persian });
        });

        it('rejects more than 10 files', async () => {
            await expect(
                service.uploadMany(
                    Array.from({ length: 11 }, () => file()),
                    chatId,
                    user,
                ),
            ).rejects.toThrow(/at most 10 files/);
            expect(attachmentRepository.save).not.toHaveBeenCalled();
        });

        it('rejects a file over 20 MB with 413', async () => {
            await expect(
                service.uploadMany(
                    [file({ size: MAX_ATTACHMENT_FILE_SIZE + 1 })],
                    chatId,
                    user,
                ),
            ).rejects.toThrow(PayloadTooLargeException);
        });

        it('rejects a request whose total exceeds 60 MB with 413', async () => {
            const size = Math.floor(MAX_ATTACHMENT_MESSAGE_SIZE / 10) + 1;
            await expect(
                service.uploadMany(
                    Array.from({ length: 10 }, () => file({ size })),
                    chatId,
                    user,
                ),
            ).rejects.toThrow(PayloadTooLargeException);
        });

        it('rejects dangerous extensions with a clear message', async () => {
            await expect(
                service.uploadMany(
                    [file({ originalname: 'virus.exe' })],
                    chatId,
                    user,
                ),
            ).rejects.toThrow(/\.exe is not allowed/);
            expect(attachmentRepository.save).not.toHaveBeenCalled();
        });

        it('rejects unknown extensions', async () => {
            await expect(
                service.uploadMany(
                    [file({ originalname: 'notes.xyz' })],
                    chatId,
                    user,
                ),
            ).rejects.toThrow(/not allowed/);
        });

        it('rejects non-image content renamed to .png (content-based image detection)', async () => {
            const text = Buffer.from('this is definitely not a png');
            await expect(
                service.uploadMany(
                    [
                        file({
                            buffer: text,
                            size: text.length,
                            mimetype: 'image/png',
                            originalname: 'fake.png',
                        }),
                    ],
                    chatId,
                    user,
                ),
            ).rejects.toThrow(/not a valid image/);
            expect(attachmentRepository.save).not.toHaveBeenCalled();
        });

        it('removes already-written files when the metadata insert fails', async () => {
            attachmentRepository.save.mockRejectedValue(new Error('db down'));

            await expect(
                service.uploadMany([file()], chatId, user),
            ).rejects.toThrow(InternalServerErrorException);

            const chatDir = path.join(config.storageDir, '10');
            await expect(fs.readdir(chatDir)).resolves.toEqual([]);
        });

        it('rejects uploads to a banned chat', async () => {
            chatRepository.findOne.mockResolvedValue({ id: 10, isBan: true });
            await expect(
                service.uploadMany([file()], chatId, user),
            ).rejects.toThrow(/chat is banned/);
        });
    });

    describe('voice uploads', () => {
        const waveform = Array.from({ length: 64 }, (_, index) => index);
        const audio = (
            over: Partial<Express.Multer.File> = {},
        ): Express.Multer.File =>
            file({
                buffer: Buffer.from('fake m4a bytes'),
                size: 14,
                mimetype: 'audio/mp4',
                originalname: 'voice-1.m4a',
                ...over,
            });

        beforeEach(() => {
            media.isAvailable = true;
            media.probeAudio.mockResolvedValue({
                mimeType: 'audio/mp4',
                duration: 5.2,
            });
            media.generateWaveform.mockResolvedValue(waveform);
        });

        it('stores a voice message with kind, duration and a 64-bar waveform', async () => {
            const [stored] = await service.uploadMany(
                [audio()],
                chatId,
                user,
                true,
            );

            expect(stored).toMatchObject({
                id: 100,
                kind: 'voice',
                mimeType: 'audio/mp4',
                duration: 5.2,
            });
            expect(stored?.waveform).toHaveLength(64);

            const saved = (
                attachmentRepository.save.mock.calls[0] as unknown as [
                    Array<{
                        voice: boolean | null;
                        waveform: number[] | null;
                        duration: string | null;
                    }>,
                ]
            )[0];
            expect(saved[0]).toMatchObject({
                voice: true,
                waveform,
                duration: '5.2',
            });
        });

        it('keeps the same audio file a regular file without voice=1', async () => {
            const [stored] = await service.uploadMany([audio()], chatId, user);

            expect(stored).toMatchObject({ kind: 'file' });
            expect(media.probeAudio).not.toHaveBeenCalled();
            const saved = (
                attachmentRepository.save.mock.calls[0] as unknown as [
                    Array<{ voice: boolean | null; waveform: number[] | null }>,
                ]
            )[0];
            expect(saved[0]).toMatchObject({ voice: null, waveform: null });
        });

        it('rejects two files in one voice upload before storing anything', async () => {
            await expect(
                service.uploadMany([audio(), audio()], chatId, user, true),
            ).rejects.toThrow(/exactly one file/);
            expect(attachmentRepository.save).not.toHaveBeenCalled();
            // No file was moved into the chat's storage directory.
            await expect(
                fs.access(path.join(config.storageDir, '10')),
            ).rejects.toThrow();
        });

        it('rejects a voice file over 15 MB with 413', async () => {
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-'));
            const tempPath = path.join(tempDir, 'big.m4a');
            await fs.writeFile(tempPath, 'x');

            await expect(
                service.uploadMany(
                    [
                        audio({
                            path: tempPath,
                            buffer: undefined as never,
                            size: MAX_VOICE_FILE_SIZE + 1,
                        }),
                    ],
                    chatId,
                    user,
                    true,
                ),
            ).rejects.toThrow(PayloadTooLargeException);
            expect(attachmentRepository.save).not.toHaveBeenCalled();
            await fs.rm(tempDir, { recursive: true, force: true });
        });

        it('rejects a text file renamed .m4a and a real video (probe returns null)', async () => {
            media.probeAudio.mockResolvedValue(null);

            await expect(
                service.uploadMany([audio()], chatId, user, true),
            ).rejects.toThrow('This file is not a valid voice recording');

            await expect(
                service.uploadMany(
                    [
                        audio({
                            originalname: 'clip.mp4',
                            mimetype: 'video/mp4',
                        }),
                    ],
                    chatId,
                    user,
                    true,
                ),
            ).rejects.toThrow('This file is not a valid voice recording');
            expect(attachmentRepository.save).not.toHaveBeenCalled();
        });

        it('rejects a recording longer than the 11-minute tolerance', async () => {
            media.probeAudio.mockRejectedValue(
                new VoiceValidationError(
                    'voice recording is longer than 10 minutes',
                ),
            );

            await expect(
                service.uploadMany([audio()], chatId, user, true),
            ).rejects.toThrow(/longer than 10 minutes/);
            expect(attachmentRepository.save).not.toHaveBeenCalled();
        });

        it('accepts the voice message with NULL bars when waveform generation fails', async () => {
            media.generateWaveform.mockResolvedValue(null);

            const [stored] = await service.uploadMany(
                [audio()],
                chatId,
                user,
                true,
            );

            expect(stored).toMatchObject({ kind: 'voice', duration: 5.2 });
            expect(stored?.waveform).toBeUndefined();
            const saved = (
                attachmentRepository.save.mock.calls[0] as unknown as [
                    Array<{ waveform: number[] | null }>,
                ]
            )[0];
            expect(saved[0]?.waveform).toBeNull();
        });

        it('fails with 503 when audio processing is unavailable', async () => {
            media.isAvailable = false;

            await expect(
                service.uploadMany([audio()], chatId, user, true),
            ).rejects.toThrow(/Audio processing is unavailable/);
            expect(attachmentRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('contentDisposition', () => {
        it('provides an ASCII fallback and an RFC 5987 UTF-8 name', () => {
            const header = contentDisposition('گزارش.pdf', false);
            expect(header.startsWith('attachment; filename="')).toBe(true);
            expect(header).toContain(
                `filename*=UTF-8''${encodeURIComponent('گزارش.pdf')}`,
            );
        });

        it('uses inline for images and escapes quotes in the fallback', () => {
            const header = contentDisposition('a"b.png', true);
            expect(header.startsWith('inline; ')).toBe(true);
            expect(header).toContain('filename="a_b.png"');
        });
    });

    describe('findUsable', () => {
        const row = (over: Record<string, unknown> = {}) => ({
            id: 7,
            uploader: { id: 1 },
            chat: { id: 10 },
            status: AttachmentStatus.PENDING,
            size: 10,
            ...over,
        });

        it('rejects a missing id', async () => {
            attachmentRepository.find.mockResolvedValue([]);
            await expect(
                service.findUsable([7 as never], 1, chatId),
            ).rejects.toThrow('attachment not found');
        });

        it("rejects another user's upload", async () => {
            attachmentRepository.find.mockResolvedValue([
                row({ uploader: { id: 2 } }),
            ]);
            await expect(
                service.findUsable([7 as never], 1, chatId),
            ).rejects.toThrow(/not uploaded by this user/);
        });

        it('rejects an attachment from another chat', async () => {
            attachmentRepository.find.mockResolvedValue([
                row({ chat: { id: 99 } }),
            ]);
            await expect(
                service.findUsable([7 as never], 1, chatId),
            ).rejects.toThrow(/belong to this chat/);
        });

        it('rejects an already-attached attachment', async () => {
            attachmentRepository.find.mockResolvedValue([
                row({ status: AttachmentStatus.ATTACHED }),
            ]);
            await expect(
                service.findUsable([7 as never], 1, chatId),
            ).rejects.toThrow(/already used/);
        });

        it('rejects a set whose combined size exceeds the message cap', async () => {
            attachmentRepository.find.mockResolvedValue([
                row({ id: 7, size: MAX_ATTACHMENT_MESSAGE_SIZE }),
                row({ id: 8, size: 1 }),
            ]);
            await expect(
                service.findUsable([7, 8] as never[], 1, chatId),
            ).rejects.toThrow(/maximum message size/);
        });
    });

    describe('bindToMessage (single-use claim)', () => {
        it('throws when fewer rows were claimed than requested', async () => {
            const manager = {
                getRepository: () => ({
                    update: jest.fn().mockResolvedValue({ affected: 1 }),
                }),
            };
            await expect(
                service.bindToMessage(manager as never, [7, 8] as never[], 100),
            ).rejects.toThrow(/already used/);
        });

        it('lets exactly one of two concurrent claims win', async () => {
            let claimed = false;
            const manager = {
                getRepository: () => ({
                    update: jest.fn().mockImplementation(() => {
                        if (claimed) return Promise.resolve({ affected: 0 });
                        claimed = true;
                        return Promise.resolve({ affected: 1 });
                    }),
                }),
            };

            const [first, second] = await Promise.allSettled([
                service.bindToMessage(manager as never, [7] as never[], 100),
                service.bindToMessage(manager as never, [7] as never[], 101),
            ]);

            expect(first?.status).toBe('fulfilled');
            expect(second?.status).toBe('rejected');
        });
    });

    describe('authorization for downloads', () => {
        const res = {} as never;
        const req = { headers: {} } as never;

        it('hides a pending attachment from everyone but its uploader (404)', async () => {
            attachmentRepository.findOne.mockResolvedValue({
                id: 5,
                status: AttachmentStatus.PENDING,
                uploader: { id: 2 },
                chat: { id: 10, isBan: false },
                message: null,
                storageKey: '10/a.png',
                mimeType: 'image/png',
                originalName: 'a.png',
            });
            await expect(
                service.download(5 as never, { sub: 1 } as never, req, res),
            ).rejects.toThrow(NotFoundException);
        });

        it('hides an attachment of a deleted message from members (404)', async () => {
            attachmentRepository.findOne.mockResolvedValue({
                id: 5,
                status: AttachmentStatus.ATTACHED,
                uploader: { id: 1 },
                chat: { id: 10, isBan: false },
                message: { id: 9, isDeleted: true },
                storageKey: '10/a.png',
                mimeType: 'image/png',
                originalName: 'a.png',
            });
            memberRepository.findOne.mockResolvedValue({
                role: { name: RoleChatEnum.USER },
            });
            await expect(
                service.download(5 as never, { sub: 1 } as never, req, res),
            ).rejects.toThrow(NotFoundException);
        });

        it('hides an attachment from a non-member (404)', async () => {
            attachmentRepository.findOne.mockResolvedValue({
                id: 5,
                status: AttachmentStatus.ATTACHED,
                uploader: { id: 1 },
                chat: { id: 10, isBan: false },
                message: { id: 9, isDeleted: false },
                storageKey: '10/a.png',
                mimeType: 'image/png',
                originalName: 'a.png',
            });
            memberRepository.findOne.mockResolvedValue(null);
            await expect(
                service.download(5 as never, { sub: 1 } as never, req, res),
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('voice download headers', () => {
        it('serves a voice file inline with its audio content type', async () => {
            const storageKey = `10/${randomUUID()}.m4a`;
            const filePath = path.join(config.storageDir, storageKey);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, Buffer.from('fake m4a bytes'));

            attachmentRepository.findOne.mockResolvedValue({
                id: 5,
                status: AttachmentStatus.ATTACHED,
                uploader: { id: 1 },
                chat: { id: 10, isBan: false },
                message: { id: 9, isDeleted: false },
                storageKey,
                mimeType: 'audio/mp4',
                originalName: 'voice-1.m4a',
                voice: true,
            });
            memberRepository.findOne.mockResolvedValue({
                role: { name: RoleChatEnum.USER },
            });

            const { PassThrough } = await import('node:stream');
            const pipe = new PassThrough();
            const res = Object.assign(pipe, {
                setHeader: jest.fn(),
                status: jest.fn().mockReturnValue(pipe),
                end: jest.fn(),
            }) as unknown as never;

            await service.download(
                5 as never,
                { sub: 1 } as never,
                { headers: {}, once: jest.fn(), off: jest.fn() } as never,
                res,
            );

            const headers = (res as unknown as { setHeader: jest.Mock })
                .setHeader;
            expect(headers).toHaveBeenCalledWith('Content-Type', 'audio/mp4');
            expect(headers).toHaveBeenCalledWith(
                'Content-Disposition',
                expect.stringMatching(/^inline;/),
            );
            expect(headers).toHaveBeenCalledWith(
                'X-Content-Type-Options',
                'nosniff',
            );
        });
    });

    describe('cleanup', () => {
        it('deletes an old unattached upload and its file', async () => {
            const storageKey = `10/${randomUUID()}.png`;
            const filePath = path.join(config.storageDir, storageKey);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, png);
            attachmentRepository.find.mockResolvedValue([
                { id: 5, storageKey },
            ]);

            const removed = await service.cleanupOrphans(
                new Date(Date.now() + 10_000),
            );

            expect(removed).toBe(1);
            expect(attachmentRepository.delete).toHaveBeenCalledWith(5);
            await expect(fs.access(filePath)).rejects.toThrow();
        });

        it('selects only attachments of messages deleted before the cutoff', async () => {
            const storageKey = `10/${randomUUID()}.png`;
            const getMany = jest
                .fn()
                .mockResolvedValue([{ id: 6, storageKey }]);
            const builder = {
                innerJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                getMany,
            };
            attachmentRepository.createQueryBuilder.mockReturnValue(builder);

            const removed = await service.cleanupDeletedMessageAttachments();

            expect(removed).toBe(1);
            expect(builder.where).toHaveBeenCalledWith(
                'message.isDeleted = true',
            );
            expect(builder.andWhere).toHaveBeenCalledWith(
                'message.updatedAt < :cutoff',
                expect.anything(),
            );
        });
    });
});
