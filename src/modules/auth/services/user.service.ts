import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { UserProfile } from '../entities/user_profile.entity';
import { Repository } from 'typeorm';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { UpdateUserDto } from '../dtos/updateUser.dto';
import * as fs from 'fs';
import * as path from 'path';
import { UserId } from 'src/common/types/brands.type';
import { toUserResponse } from '../utils/user-response.util';
import { detectFileMimeType } from 'src/modules/attachments/utils/file-signature.util';
import { isAvatarMimeType } from '../utils/avatar.util';

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(UserProfile)
        private readonly profileRepository: Repository<UserProfile>,
    ) {}

    async onlineUser(user: JwtPayload) {
        await this.userRepository.update({ id: user.sub }, { isOnline: true });
    }

    async offlineUser(user: JwtPayload) {
        await this.userRepository.update(
            { id: user.sub },
            { isOnline: false, lastSeen: new Date() },
        );
    }

    async getUserByUsername(username: string) {
        const profile = await this.profileRepository.findOne({
            where: { username },
            relations: { user: true },
            select: {
                id: true,
                name: true,
                username: true,
                biografy: true,
                avatars: true,
                createdAt: true,
                updatedAt: true,
                user: {
                    id: true,
                    phone: true,
                    isOnline: true,
                    lastSeen: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                },
            },
        });
        if (!profile) throw new NotFoundException('user not found');

        return { data: toUserResponse({ ...profile.user, profile }) };
    }

    async updateUser(dto: UpdateUserDto, user: JwtPayload) {
        const profile = await this.getOrCreateProfile(user.sub);

        if (dto.name !== undefined) profile.name = dto.name;
        if (dto.username !== undefined) profile.username = dto.username;
        if (dto.biografy !== undefined) profile.biografy = dto.biografy;

        try {
            await this.profileRepository.save(profile);
        } catch (err) {
            if (this.isUniqueViolation(err)) {
                throw new ConflictException('username already exists');
            }
            throw new InternalServerErrorException((err as Error).message);
        }

        return { message: 'user updated is 1' };
    }

    /**
     * Stores the uploaded file as the caller's current avatar and returns the
     * updated user, so the client can confirm persistence without a refetch.
     *
     * The extension/Content-Type the client sent is not trusted: the bytes are
     * sniffed first, and anything that is not a raster image is deleted again
     * (avatars are served statically from the API origin).
     */
    async uploadAvatar(file: Express.Multer.File, user: JwtPayload) {
        const detectedMime = await this.detectUploadedMime(file.path);
        if (detectedMime === null || !isAvatarMimeType(detectedMime)) {
            await fs.promises.unlink(file.path).catch(() => undefined);
            throw new BadRequestException(
                'avatar file content is not a supported image (jpeg, png, gif, webp)',
            );
        }

        const profile = await this.getOrCreateProfile(user.sub);

        // Same shape the static handler serves: relative to the cwd, forward
        // slashes, no absolute server paths in the database.
        const storedPath = path
            .relative(process.cwd(), file.path)
            .split(path.sep)
            .join('/');
        profile.avatars = [...(profile.avatars ?? []), storedPath];
        await this.profileRepository.save(profile);

        const owner = await this.userRepository.findOne({
            where: { id: user.sub },
            relations: { role: true, profile: true },
        });
        if (!owner) throw new NotFoundException('user not found');

        return {
            message: 'avatar updated successfully',
            user: toUserResponse(owner),
        };
    }

    /** Reads the first bytes of an uploaded file to detect its real type. */
    private async detectUploadedMime(filePath: string): Promise<string | null> {
        const handle = await fs.promises.open(filePath, 'r');
        try {
            const buffer = Buffer.alloc(512);
            const { bytesRead } = await handle.read(
                buffer,
                0,
                buffer.length,
                0,
            );
            return detectFileMimeType(buffer.subarray(0, bytesRead));
        } finally {
            await handle.close();
        }
    }

    async deleteAvatar(avatarPath: string, user: JwtPayload) {
        const profile = await this.getOrCreateProfile(user.sub);

        if (!(profile.avatars ?? []).includes(avatarPath))
            throw new NotFoundException();

        profile.avatars = profile.avatars.filter(
            (avatar) => avatar !== avatarPath,
        );
        await this.profileRepository.save(profile);

        if (fs.existsSync(avatarPath)) {
            await fs.promises.unlink(avatarPath);
        }

        return { message: 'avatar updated successfully' };
    }

    async deleteAllAvatar(userId: UserId): Promise<void> {
        const profile = await this.getOrCreateProfile(userId);
        const avatars = profile.avatars ?? [];

        try {
            for (const img of avatars) {
                const fileExists = await fs.promises
                    .stat(img)
                    .then(() => true)
                    .catch(() => false);
                if (fileExists) {
                    await fs.promises.unlink(img);
                }
            }
        } catch (err) {
            throw new InternalServerErrorException((err as Error).message);
        }

        profile.avatars = [];
        await this.profileRepository.save(profile);
    }

    private async getOrCreateProfile(userId: UserId): Promise<UserProfile> {
        const existing = await this.profileRepository.findOne({
            where: { user: { id: userId } },
        });
        if (existing) return existing;

        try {
            return await this.profileRepository.save(
                this.profileRepository.create({ user: { id: userId } }),
            );
        } catch (err) {
            if (this.isUniqueViolation(err)) {
                const profile = await this.profileRepository.findOne({
                    where: { user: { id: userId } },
                });
                if (profile) return profile;
            }
            throw new InternalServerErrorException((err as Error).message);
        }
    }

    private isUniqueViolation(err: unknown): boolean {
        const code = (err as { driverError?: { code?: string } }).driverError
            ?.code;
        return code === '23505';
    }
}
