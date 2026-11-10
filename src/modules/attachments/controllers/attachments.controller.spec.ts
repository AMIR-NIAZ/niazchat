import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { ChatAttachmentsController } from './attachments.controller';
import { AttachmentService } from '../services/attachment.service';
import { AttachmentConfig } from '../attachment.config';
import { IsBanMember } from 'src/common/guards/restGuards/IsBanMember.guard';

/**
 * Multipart ordering regression tests.
 *
 * Multer only exposes text parts that arrive BEFORE the file part, so the
 * upload must decide `voice` in the controller/service AFTER parsing. These
 * tests send the file first, then `voice`, and assert the decision still
 * reaches the service.
 */
describe('ChatAttachmentsController voice field ordering', () => {
    let app: INestApplication;
    let storageRoot: string;
    let uploadMany: jest.Mock;

    const stored = {
        id: 12,
        originalName: 'voice-1.m4a',
        mimeType: 'audio/mp4',
        size: 1_024,
        kind: 'voice' as const,
        duration: 5.2,
        waveform: new Array(64).fill(40),
    };

    beforeAll(async () => {
        storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-upload-'));
        uploadMany = jest.fn().mockResolvedValue([stored]);

        const moduleRef = await Test.createTestingModule({
            controllers: [ChatAttachmentsController],
            providers: [
                { provide: AttachmentService, useValue: { uploadMany } },
                AttachmentConfig,
                {
                    provide: ConfigService,
                    useValue: {
                        get: (key: string): string | undefined =>
                            key === 'STORAGE_DIR' ? storageRoot : undefined,
                    },
                },
            ],
        })
            .overrideGuard(IsBanMember)
            .useValue({ canActivate: (): boolean => true })
            .compile();

        app = moduleRef.createNestApplication();
        // Stand in for the JWT guard, which normally sets `req.user`.
        app.use(
            (
                req: { user?: { sub: number; role: string } },
                _res: unknown,
                next: () => void,
            ): void => {
                req.user = { sub: 1, role: 'user' };
                next();
            },
        );
        await app.init();
    });

    afterAll(async () => {
        await app.close();
        await fs.rm(storageRoot, { recursive: true, force: true });
    });

    beforeEach(() => {
        uploadMany.mockClear();
    });

    it('keeps a file part sent BEFORE the voice field as a voice message', async () => {
        await request(app.getHttpServer())
            .post('/chats/10/attachments')
            .attach('files', Buffer.from('fake m4a bytes'), {
                filename: 'voice-1.m4a',
                contentType: 'audio/mp4',
            })
            .field('voice', '1')
            .expect(201);

        expect(uploadMany).toHaveBeenCalledTimes(1);
        const call = uploadMany.mock.calls[0] as unknown as [
            Express.Multer.File[],
            number,
            unknown,
            boolean,
        ];
        expect(call[1]).toBe(10);
        expect(call[3]).toBe(true);
    });

    it('treats a file with no voice field as a regular file', async () => {
        await request(app.getHttpServer())
            .post('/chats/10/attachments')
            .attach('files', Buffer.from('fake audio bytes'), {
                filename: 'track.m4a',
                contentType: 'audio/mp4',
            })
            .expect(201);

        const call = uploadMany.mock.calls[0] as unknown as [
            Express.Multer.File[],
            number,
            unknown,
            boolean,
        ];
        expect(call[3]).toBe(false);
    });

    it('also keeps voice when the field is sent before the file', async () => {
        await request(app.getHttpServer())
            .post('/chats/10/attachments')
            .field('voice', '1')
            .attach('files', Buffer.from('fake m4a bytes'), {
                filename: 'voice-2.m4a',
                contentType: 'audio/mp4',
            })
            .expect(201);

        const call = uploadMany.mock.calls[0] as unknown as [
            Express.Multer.File[],
            number,
            unknown,
            boolean,
        ];
        expect(call[3]).toBe(true);
    });
});
