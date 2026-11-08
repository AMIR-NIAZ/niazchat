import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { resolveAvatarFilePath } from '../auth/utils/avatar.util';
import {
    avatarThumbnailPath,
    AvatarThumbnailSize,
    safeAvatarFileName,
} from './avatar-thumbnail.util';

export interface AvatarThumbnailResult {
    /** Absolute path of the cached thumbnail. */
    path: string;
    /** True only for the request that actually ran the encoder. */
    generated: boolean;
}

async function exists(filePath: string): Promise<boolean> {
    return fs.promises
        .access(filePath)
        .then((): true => true)
        .catch((): false => false);
}

/**
 * On-demand, disk-cached avatar thumbnails (WebP, square cover crop).
 *
 * - Decoding is bounded (`limitInputPixels`): an oversized/decompression-bomb
 *   image is rejected instead of exhausting memory.
 * - The same (size, file) is generated once: concurrent first requests await
 *   the same promise instead of racing on the encoder.
 * - Writing is atomic (temp file in the target directory + `rename`), so a
 *   reader never sees a half-written WebP and a failed generation leaves no
 *   corrupt file. Failures are not cached.
 */
@Injectable()
export class AvatarThumbnailService {
    private readonly inFlight = new Map<string, Promise<void>>();

    async get(
        size: AvatarThumbnailSize,
        rawFileName: string,
    ): Promise<AvatarThumbnailResult> {
        const fileName = safeAvatarFileName(rawFileName);
        if (fileName === null) {
            throw new BadRequestException('invalid avatar file name');
        }

        const original = resolveAvatarFilePath(fileName);
        if (original === null) {
            throw new BadRequestException('invalid avatar file name');
        }
        if (!(await exists(original))) {
            throw new NotFoundException('avatar not found');
        }

        const target = avatarThumbnailPath(size, fileName);
        const key = `${size}/${fileName}`;

        if (await exists(target)) {
            return { path: target, generated: false };
        }

        // Re-check AFTER the only await: check → start job → register is one
        // synchronous block, so concurrent first requests cannot both encode.
        const pending = this.inFlight.get(key);
        if (pending !== undefined) {
            await pending;
            return { path: target, generated: false };
        }

        const job = this.generate(original, target, size).finally((): void => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, job);
        await job;
        return { path: target, generated: true };
    }

    /** Encodes `original` into `target` atomically. */
    private async generate(
        original: string,
        target: string,
        size: AvatarThumbnailSize,
    ): Promise<void> {
        await fs.promises.mkdir(dirname(target), { recursive: true });
        const temporary = join(
            dirname(target),
            `${process.pid}-${randomUUID()}.tmp`,
        );

        try {
            await sharp(original, {
                limitInputPixels: 40_000_000,
                failOn: 'error',
            })
                // EXIF orientation first, so a rotated phone photo is not
                // squeezed into the square crop.
                .rotate()
                .resize({ width: size, height: size, fit: 'cover' })
                .webp({ quality: 75 })
                .toFile(temporary);
        } catch (error) {
            await fs.promises.unlink(temporary).catch((): void => undefined);
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new NotFoundException('avatar not found');
            }
            throw error;
        }

        try {
            await fs.promises.rename(temporary, target);
        } catch (error) {
            await fs.promises.unlink(temporary).catch((): void => undefined);
            throw error;
        }
    }
}
