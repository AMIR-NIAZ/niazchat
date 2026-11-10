import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import { ChatId } from 'src/common/types/brands.type';

describe('AttachmentService.copyFilesForForward', () => {
    let root: string;
    let service: AttachmentService;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'forward-files-'));
        service = new AttachmentService(
            {} as never,
            {} as never,
            {} as never,
            {
                storageDir: path.join(root, 'attachments'),
                previewDir: path.join(root, 'previews'),
            } as never,
            {} as never,
        );
        const sourceDir = path.join(root, 'attachments', '1');
        await fs.mkdir(sourceDir, { recursive: true });
        await fs.writeFile(path.join(sourceDir, 'a.mp4'), 'video-bytes');
        await fs.writeFile(
            path.join(sourceDir, 'a.poster.webp'),
            'poster-bytes',
        );
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it('hard-links the file and poster, and deleting one name keeps the other', async () => {
        const copied = await service.copyFilesForForward(
            { storageKey: '1/a.mp4', posterPath: '1/a.poster.webp' },
            2 as ChatId,
        );
        const original = path.join(root, 'attachments', '1', 'a.mp4');
        const target = path.join(root, 'attachments', copied.storageKey);
        expect(await fs.readFile(target, 'utf8')).toBe('video-bytes');
        expect((await fs.stat(original)).ino).toBe((await fs.stat(target)).ino);

        await service.deleteFile(copied.storageKey, copied.posterPath);
        await expect(fs.stat(original)).resolves.toBeDefined();
        await expect(fs.stat(target)).rejects.toThrow();

        // Deleting the original must not break a fresh forwarded copy.
        const second = await service.copyFilesForForward(
            { storageKey: '1/a.mp4', posterPath: null },
            3 as ChatId,
        );
        await fs.rm(original);
        await expect(
            fs.readFile(
                path.join(root, 'attachments', second.storageKey),
                'utf8',
            ),
        ).resolves.toBe('video-bytes');
    });

    it('fails clearly when the source file is missing', async () => {
        await fs.rm(path.join(root, 'attachments', '1', 'a.mp4'));
        await expect(
            service.copyFilesForForward(
                { storageKey: '1/a.mp4', posterPath: null },
                2 as ChatId,
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
