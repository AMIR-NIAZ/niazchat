import { BadRequestException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Response } from 'express';
import { AvatarThumbnailService } from './avatar-thumbnail.service';
import { MediaController } from './media.controller';
import {
    avatarThumbnailPath,
    avatarsDirectory,
    AVATAR_THUMBNAIL_SIZES,
    AVATAR_THUMBNAIL_CACHE_CONTROL,
    isAvatarThumbnailSize,
    removeAvatarThumbnails,
    safeAvatarFileName,
} from './avatar-thumbnail.util';

const FILE_NAME = 'jest-thumb-test.png';

function fakeResponse(): {
    response: Response;
    setHeader: jest.Mock;
    sendFile: jest.Mock;
} {
    const setHeader = jest.fn();
    const sendFile = jest.fn();
    return {
        setHeader,
        sendFile,
        response: { setHeader, sendFile } as unknown as Response,
    };
}

describe('avatar thumbnail rules', () => {
    afterAll(async () => {
        await fs.promises
            .unlink(path.join(avatarsDirectory(), FILE_NAME))
            .catch((): void => undefined);
        await removeAvatarThumbnails(FILE_NAME);
    });

    it('accepts only the allowlisted sizes', () => {
        for (const size of AVATAR_THUMBNAIL_SIZES) {
            expect(isAvatarThumbnailSize(size)).toBe(true);
            expect(isAvatarThumbnailSize(String(size))).toBe(true);
        }
        for (const size of [32, 65, 512, 0, -64, 'abc', null, undefined]) {
            expect(isAvatarThumbnailSize(size)).toBe(false);
        }
    });

    it('rejects path traversal and unknown names', () => {
        for (const name of [
            '../x.png',
            '..%2Fx.png',
            'a/b.png',
            '/etc/passwd',
            '..',
            '.',
            'x.php',
            'x.png.exe',
            '',
        ]) {
            expect(safeAvatarFileName(name)).toBeNull();
        }
        expect(safeAvatarFileName(FILE_NAME)).toBe(FILE_NAME);
        expect(safeAvatarFileName('uploads/avatars/a-b_c.png')).toBeNull();
    });

    it('keeps thumbnails outside the originals directory', () => {
        expect(avatarThumbnailPath(64, FILE_NAME)).not.toContain(
            path.join('uploads', 'avatars'),
        );
        expect(avatarThumbnailPath(64, FILE_NAME)).toContain(
            path.join('uploads', 'thumbs', '64'),
        );
    });

    it('merges concurrent first requests into one generation', async () => {
        await fs.promises.mkdir(avatarsDirectory(), { recursive: true });
        await fs.promises.writeFile(
            path.join(avatarsDirectory(), FILE_NAME),
            Buffer.from('not-an-image'),
        );

        const service = new AvatarThumbnailService();
        const generate = jest
            .spyOn(
                service as unknown as { generate: () => Promise<void> },
                'generate',
            )
            .mockImplementation(async (...args: unknown[]): Promise<void> => {
                const target = args[1] as string;
                await fs.promises.mkdir(path.dirname(target), {
                    recursive: true,
                });
                await fs.promises.writeFile(target, Buffer.from('thumb'));
            });

        const results = await Promise.all(
            Array.from({ length: 20 }, () => service.get(64, FILE_NAME)),
        );

        expect(generate).toHaveBeenCalledTimes(1);
        expect(results.filter((result) => result.generated)).toHaveLength(1);
        expect(new Set(results.map((result) => result.path)).size).toBe(1);
        expect(await fs.promises.readFile(avatarThumbnailPath(64, FILE_NAME), 'utf8'))
            .toBe('thumb');
    });

    it('removes every cached thumbnail of a deleted avatar', async () => {
        for (const size of AVATAR_THUMBNAIL_SIZES) {
            const target = avatarThumbnailPath(size, FILE_NAME);
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            await fs.promises.writeFile(target, Buffer.from('thumb'));
        }

        await removeAvatarThumbnails(`uploads/avatars/${FILE_NAME}`);

        for (const size of AVATAR_THUMBNAIL_SIZES) {
            await expect(
                fs.promises.access(avatarThumbnailPath(size, FILE_NAME)),
            ).rejects.toBeTruthy();
        }
        // Never throws for hostile input either.
        await expect(removeAvatarThumbnails('../../etc/passwd')).resolves.toBeUndefined();
    });
});

describe('MediaController', () => {
    it('rejects a size outside the allowlist with 400', async () => {
        const get = jest.fn();
        const controller = new MediaController({
            get,
        } as unknown as AvatarThumbnailService);
        const { response } = fakeResponse();

        await expect(
            controller.avatarThumbnail('32', FILE_NAME, response),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            controller.avatarThumbnail('64x', FILE_NAME, response),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(get).not.toHaveBeenCalled();
    });

    it('rejects traversal file names before touching the service', async () => {
        const get = jest.fn();
        const controller = new MediaController({
            get,
        } as unknown as AvatarThumbnailService);
        const { response } = fakeResponse();

        await expect(
            controller.avatarThumbnail('64', '../x.png', response),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(get).not.toHaveBeenCalled();
    });

    it('serves a thumbnail with immutable cache headers', async () => {
        const get = jest.fn().mockResolvedValue({
            path: avatarThumbnailPath(128, FILE_NAME),
            generated: true,
        });
        const controller = new MediaController({
            get,
        } as unknown as AvatarThumbnailService);
        const { response, setHeader, sendFile } = fakeResponse();

        await controller.avatarThumbnail('128', FILE_NAME, response);

        expect(get).toHaveBeenCalledWith(128, FILE_NAME);
        expect(setHeader).toHaveBeenCalledWith(
            'Cache-Control',
            AVATAR_THUMBNAIL_CACHE_CONTROL,
        );
        expect(AVATAR_THUMBNAIL_CACHE_CONTROL).toContain('immutable');
        expect(AVATAR_THUMBNAIL_CACHE_CONTROL).toContain('max-age=31536000');
        expect(setHeader).toHaveBeenCalledWith(
            'X-Avatar-Thumbnail',
            'generated',
        );
        expect(sendFile).toHaveBeenCalled();
    });
});
