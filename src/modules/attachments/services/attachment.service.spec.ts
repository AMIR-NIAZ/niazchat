import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
    BadRequestException,
    ForbiddenException,
    InternalServerErrorException,
} from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import { Attachment } from '../entities/attachment.entity';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { AttachmentConfig } from '../attachment.config';
import { AttachmentStatus } from '../enums/attachmentStatus.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { promises as fsPromises } from 'node:fs';

const PNG_MAGIC = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
]);

const makeConfig = () =>
    new AttachmentConfig({
        get: (key: string) => {
            const values: Record<string, string> = {
                UPLOAD_MAX_FILE_SIZE: '10485760',
                UPLOAD_ALLOWED_EXTENSIONS: 'png,jpg,pdf,mp4,mp3,txt',
                STORAGE_DIR: './storage',
            };
            return values[key];
        },
    } as unknown as ConfigService);

describe('AttachmentService', () => {
    let service: AttachmentService;
    let attachmentRepository: {
        save: jest.Mock;
        findOne: jest.Mock;
        find: jest.Mock;
        update: jest.Mock;
    };
    let memberRepository: { findOne: jest.Mock };

    const uploader = { id: 1, sub: 1 as never, role: 'user' };
    const chat = { id: 10 };

    beforeEach(async () => {
        jest.clearAllMocks();
        jest.spyOn(fsPromises, 'mkdir').mockImplementation((() =>
            Promise.resolve(undefined)) as never);
        jest.spyOn(fsPromises, 'writeFile').mockImplementation((() =>
            Promise.resolve(undefined)) as never);
        jest.spyOn(fsPromises, 'rm').mockImplementation((() =>
            Promise.resolve(undefined)) as never);

        attachmentRepository = {
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
        };
        memberRepository = { findOne: jest.fn() };

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
                { provide: AttachmentConfig, useFactory: makeConfig },
            ],
        }).compile();

        service = module.get<AttachmentService>(AttachmentService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('upload', () => {
        const file = (over: Partial<Express.Multer.File> = {}) =>
            ({
                buffer: PNG_MAGIC,
                size: PNG_MAGIC.length,
                mimetype: 'image/png',
                originalname: 'photo.png',
                ...over,
            }) as Express.Multer.File;

        it('stores the file and saves metadata for a valid png upload', async () => {
            attachmentRepository.save.mockResolvedValue({
                id: 1,
                originalName: 'photo.png',
                storageKey: 'uuid.png',
                mimeType: 'image/png',
                size: PNG_MAGIC.length,
                chat,
                status: AttachmentStatus.PENDING,
            });

            const result = await service.upload(
                file(),
                10 as never,
                uploader as never,
            );

            expect(result.id).toBe(1);
            expect(fsPromises.writeFile).toHaveBeenCalledWith(
                expect.stringMatching(
                    /storage[/\\]attachments[/\\][0-9a-f-]+\.png$/,
                ),
                PNG_MAGIC,
            );
            expect(attachmentRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    mimeType: 'image/png',
                    size: PNG_MAGIC.length,
                    chat: { id: 10 },
                    uploader: { id: 1 },
                }),
            );
            const savedRow = attachmentRepository.save.mock
                .calls[0][0] as unknown as { storageKey: string };
            expect(savedRow.storageKey).not.toContain('photo');
            expect(savedRow.storageKey).toMatch(/\.png$/);
        });

        it('rejects a missing file', async () => {
            await expect(
                service.upload(
                    undefined as never,
                    10 as never,
                    uploader as never,
                ),
            ).rejects.toThrow(BadRequestException);
            expect(fsPromises.writeFile).not.toHaveBeenCalled();
        });

        it('rejects an empty upload', async () => {
            await expect(
                service.upload(
                    file({ buffer: Buffer.alloc(0), size: 0 }),
                    10 as never,
                    uploader as never,
                ),
            ).rejects.toThrow(BadRequestException);
        });

        it('rejects a file exceeding the configured size limit', async () => {
            await expect(
                service.upload(
                    file({ size: 999999999 }),
                    10 as never,
                    uploader as never,
                ),
            ).rejects.toThrow(BadRequestException);
            expect(fsPromises.writeFile).not.toHaveBeenCalled();
        });

        it('rejects a mime type outside the allowlist', async () => {
            await expect(
                service.upload(
                    file({ mimetype: 'text/html' }),
                    10 as never,
                    uploader as never,
                ),
            ).rejects.toThrow('file type is not allowed');
            expect(fsPromises.writeFile).not.toHaveBeenCalled();
        });

        it('rejects spoofed content that does not match the declared type', async () => {
            const jpegBytes = Buffer.concat([
                Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
                Buffer.alloc(64, 2),
            ]);
            await expect(
                service.upload(
                    file({ mimetype: 'image/png', buffer: jpegBytes }),
                    10 as never,
                    uploader as never,
                ),
            ).rejects.toThrow('does not match');
            expect(fsPromises.writeFile).not.toHaveBeenCalled();
        });

        it('removes the stored file when the metadata insert fails', async () => {
            attachmentRepository.save.mockRejectedValue(new Error('db down'));

            await expect(
                service.upload(file(), 10 as never, uploader as never),
            ).rejects.toThrow(InternalServerErrorException);

            expect(fsPromises.rm).toHaveBeenCalledWith(
                expect.stringMatching(/\.png$/),
                { force: true },
            );
        });
    });

    describe('download authorization', () => {
        it('rejects a nonexistent attachment', async () => {
            attachmentRepository.findOne.mockResolvedValue(null);
            await expect(
                service.download(999 as never, uploader as never, {} as never),
            ).rejects.toThrow(/attachment not found/);
        });

        it('lets only the uploader read a pending (unsent) attachment', async () => {
            attachmentRepository.findOne.mockResolvedValue({
                id: 5,
                status: AttachmentStatus.PENDING,
                uploader: { id: 2 },
                chat,
                storageKey: 'a.png',
            });

            await expect(
                service.download(
                    5 as never,
                    { sub: 1 as never } as never,
                    {} as never,
                ),
            ).rejects.toThrow(ForbiddenException);
        });

        it('rejects attached attachments for users outside the chat', async () => {
            attachmentRepository.findOne.mockResolvedValue({
                id: 5,
                status: AttachmentStatus.ATTACHED,
                uploader: { id: 1 },
                chat,
                storageKey: 'a.png',
            });
            memberRepository.findOne.mockResolvedValue(null);

            await expect(
                service.download(
                    5 as never,
                    { sub: 1 as never } as never,
                    {} as never,
                ),
            ).rejects.toThrow(ForbiddenException);
        });

        it('rejects banned chat members', async () => {
            attachmentRepository.findOne.mockResolvedValue({
                id: 5,
                status: AttachmentStatus.ATTACHED,
                uploader: { id: 1 },
                chat,
                storageKey: 'a.png',
            });
            memberRepository.findOne.mockResolvedValue({
                role: { name: RoleChatEnum.BAN },
            });

            await expect(
                service.download(
                    5 as never,
                    { sub: 1 as never } as never,
                    {} as never,
                ),
            ).rejects.toThrow(ForbiddenException);
        });
    });

    describe('findUsable', () => {
        it('rejects attachments missing from the result set', async () => {
            attachmentRepository.find.mockResolvedValue([]);
            await expect(
                service.findUsable([7 as never], 1, 10 as never),
            ).rejects.toThrow(/attachment not found/);
        });

        it('rejects a foreign uploader', async () => {
            attachmentRepository.find.mockResolvedValue([
                {
                    id: 7,
                    uploader: { id: 2 },
                    chat,
                    status: AttachmentStatus.PENDING,
                },
            ]);
            await expect(
                service.findUsable([7 as never], 1, 10 as never),
            ).rejects.toThrow(ForbiddenException);
        });

        it('rejects attachments uploaded for another chat', async () => {
            attachmentRepository.find.mockResolvedValue([
                {
                    id: 7,
                    uploader: { id: 1 },
                    chat: { id: 99 },
                    status: AttachmentStatus.PENDING,
                },
            ]);
            await expect(
                service.findUsable([7 as never], 1, 10 as never),
            ).rejects.toThrow(/belong to this chat/);
        });

        it('rejects already-consumed attachments', async () => {
            attachmentRepository.find.mockResolvedValue([
                {
                    id: 7,
                    uploader: { id: 1 },
                    chat,
                    status: AttachmentStatus.ATTACHED,
                },
            ]);
            await expect(
                service.findUsable([7 as never], 1, 10 as never),
            ).rejects.toThrow(/already used/);
        });
    });
});
