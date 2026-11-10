import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { UserProfile } from '../entities/user_profile.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { UpdateUserDto } from '../dtos/updateUser.dto';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import * as fs from 'fs';
import * as path from 'path';
import { UserId } from 'src/common/types/brands.type';
import { toUserResponse } from '../utils/user-response.util';
import { toPublicUserProfile } from '../utils/public-profile.util';
import { detectFileMimeType } from 'src/modules/attachments/utils/file-signature.util';
import {
    avatarFileNameOf,
    isAvatarMimeType,
    MAX_USER_AVATARS,
    resolveAvatarFilePath,
    storedAvatarPath,
} from '../utils/avatar.util';
import { removeAvatarThumbnails } from 'src/modules/media/avatar-thumbnail.util';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import {
    USER_SEARCH_RATE_LIMIT,
    USER_SEARCH_RATE_WINDOW_SECONDS,
    escapeLikePattern,
    normalizeSearchLimit,
    normalizeUserSearch,
    userSearchRateKey,
} from '../utils/user-search.util';

/** Row shape of the locked profile inside an avatar transaction. */
interface LockedProfileRow {
    id: string;
    avatars: string[] | null;
}

@Injectable()
export class UserService {
    private readonly logger = new Logger(UserService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(UserProfile)
        private readonly profileRepository: Repository<UserProfile>,
        private readonly dataSource: DataSource,
        private readonly rateLimit: RateLimitService,
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

    /**
     * Public profile of ANY user for any authenticated caller (no shared-chat
     * requirement). Unknown and non-active users are indistinguishable: both
     * answer the same 404, so the route cannot be used to probe account state.
     */
    async getPublicProfile(userId: number) {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw new BadRequestException('userId must be a positive integer');
        }

        const user = await this.userRepository.findOne({
            where: { id: userId as UserId, status: UserStatusEnum.ACTIVE },
            relations: { profile: true },
        });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        return toPublicUserProfile(user);
    }

    /**
     * `GET /user/search`: prefix search over usernames, active users only,
     * never the caller. Returns a whitelist projection (no phone, no status).
     * ILIKE wildcards in the query are escaped, so `%`/`_` match literally.
     */
    async searchUsers(callerId: number, rawQuery: unknown, rawLimit: unknown) {
        const query = normalizeUserSearch(rawQuery);
        const limit = normalizeSearchLimit(rawLimit);

        await this.rateLimit.consume(
            userSearchRateKey(callerId),
            USER_SEARCH_RATE_LIMIT,
            USER_SEARCH_RATE_WINDOW_SECONDS,
            'Too many searches, try again later',
        );

        const pattern = `${escapeLikePattern(query)}%`;
        const rows = await this.profileRepository
            .createQueryBuilder('profile')
            .innerJoinAndSelect('profile.user', 'user')
            .where('user.status = :status', { status: UserStatusEnum.ACTIVE })
            .andWhere('user.id != :callerId', { callerId })
            .andWhere('profile.username IS NOT NULL')
            .andWhere("profile.username ILIKE :pattern ESCAPE '\\'", {
                pattern,
            })
            .orderBy('LOWER(profile.username)', 'ASC')
            .take(limit)
            .getMany();

        return {
            data: rows.map((profile) => ({
                id: Number(profile.user.id),
                name: profile.name ?? 'بدون نام',
                username: profile.username ?? '',
                // Current photo only (backend convention: `avatars[0]`).
                avatars:
                    profile.avatars?.length > 0 ? [profile.avatars[0]] : [],
            })),
        };
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

    /** Number of photos the caller currently has (early upload guard). */
    async countAvatars(userId: UserId): Promise<number> {
        const profile = await this.profileRepository.findOne({
            where: { user: { id: userId } },
        });
        return profile?.avatars?.length ?? 0;
    }

    /**
     * Stores the uploaded file as the caller's current avatar (index 0) and
     * returns the updated user, so the client can confirm persistence without a
     * refetch.
     *
     * The client's file name and declared type are not trusted: the bytes are
     * sniffed and must match the declared image type. Anything else is deleted
     * again (avatars are served statically from the API origin).
     *
     * The array write is a single SQL statement under a row lock; the 10-photo
     * limit is checked in that same transaction, so two concurrent uploads
     * cannot exceed it or lose an avatar. If the DB write fails the just-stored
     * file is removed again.
     */
    async uploadAvatar(file: Express.Multer.File, user: JwtPayload) {
        const detectedMime = await this.detectUploadedMime(file.path);
        const declaredMime = (file.mimetype ?? '').toLowerCase();
        if (
            detectedMime === null ||
            !isAvatarMimeType(detectedMime) ||
            detectedMime !== declaredMime
        ) {
            await this.removeStoredFile(file.path);
            throw new BadRequestException(
                'avatar file content is not a supported image (jpeg, png, webp)',
            );
        }

        const storedPath = storedAvatarPath(file.path);

        try {
            await this.dataSource.transaction(async (manager) => {
                const profile = await this.lockProfile(manager, user.sub);
                const avatars = profile.avatars ?? [];
                if (avatars.length >= MAX_USER_AVATARS) {
                    throw new BadRequestException(
                        `You can have at most ${MAX_USER_AVATARS} profile photos. Delete one before uploading a new photo.`,
                    );
                }
                await manager.query(
                    `UPDATE "user_profiles"
                     SET "avatars" = array_prepend($1::text, "avatars"), "updatedAt" = now()
                     WHERE "id" = $2`,
                    [storedPath, profile.id],
                );
            });
        } catch (error) {
            await this.removeStoredFile(file.path);
            throw error;
        }

        return {
            message: 'avatar added successfully',
            user: toUserResponse(await this.requireOwner(user.sub)),
        };
    }

    /**
     * Removes ONE avatar identified by its stored file name. The name must match
     * an entry in the caller's own `avatars` array (compared by basename); the
     * file path is always rebuilt from that stored entry, never from the param.
     *
     * Removing the current photo promotes the next one automatically (array
     * order), removing the last leaves the user with no avatar.
     */
    async removeAvatar(rawFileName: string, user: JwtPayload) {
        const fileName = avatarFileNameOf(rawFileName);
        if (fileName === null) {
            throw new BadRequestException('invalid avatar file name');
        }

        const removed: { storedPath: string | null } = { storedPath: null };

        await this.dataSource.transaction(async (manager) => {
            const profile = await this.lockProfile(manager, user.sub);
            const entry = (profile.avatars ?? []).find(
                (value) => path.basename(value) === fileName,
            );
            if (entry === undefined) {
                throw new NotFoundException('avatar not found');
            }
            await manager.query(
                `UPDATE "user_profiles"
                 SET "avatars" = array_remove("avatars", $1::text), "updatedAt" = now()
                 WHERE "id" = $2`,
                [entry, profile.id],
            );
            removed.storedPath = entry;
        });

        if (removed.storedPath !== null) {
            await this.removeStoredAvatar(removed.storedPath);
        }

        return {
            message: 'avatar deleted successfully',
            user: toUserResponse(await this.requireOwner(user.sub)),
        };
    }

    /**
     * Makes one of the caller's avatars current by moving it to index 0 while
     * keeping the relative order of the others. Reordering is one SQL statement
     * (`array_remove` + `array_prepend`) under a row lock.
     */
    async setMainAvatar(rawFileName: string, user: JwtPayload) {
        const fileName = avatarFileNameOf(rawFileName);
        if (fileName === null) {
            throw new BadRequestException('invalid avatar file name');
        }

        await this.dataSource.transaction(async (manager) => {
            const profile = await this.lockProfile(manager, user.sub);
            const entry = (profile.avatars ?? []).find(
                (value) => path.basename(value) === fileName,
            );
            if (entry === undefined) {
                throw new NotFoundException('avatar not found');
            }
            await manager.query(
                `UPDATE "user_profiles"
                 SET "avatars" = array_prepend($1::text, array_remove("avatars", $1::text)),
                     "updatedAt" = now()
                 WHERE "id" = $2`,
                [entry, profile.id],
            );
        });

        return {
            message: 'current avatar updated successfully',
            user: toUserResponse(await this.requireOwner(user.sub)),
        };
    }

    /**
     * Legacy endpoint kept for old clients: the body carries the exact stored
     * path (not just the file name). It is matched against the caller's array
     * verbatim, exactly as before; the response shape is unchanged.
     */
    async deleteAvatar(avatarPath: string, user: JwtPayload) {
        if (typeof avatarPath !== 'string' || avatarPath.trim() === '') {
            throw new BadRequestException('avatar is required');
        }

        const removed: { storedPath: string | null } = { storedPath: null };

        await this.dataSource.transaction(async (manager) => {
            const profile = await this.lockProfile(manager, user.sub);
            const entry = (profile.avatars ?? []).find(
                (value) => value === avatarPath,
            );
            if (entry === undefined) throw new NotFoundException();
            await manager.query(
                `UPDATE "user_profiles"
                 SET "avatars" = array_remove("avatars", $1::text), "updatedAt" = now()
                 WHERE "id" = $2`,
                [entry, profile.id],
            );
            removed.storedPath = entry;
        });

        if (removed.storedPath !== null) {
            await this.removeStoredAvatar(removed.storedPath);
        }

        return { message: 'avatar updated successfully' };
    }

    /** Ban housekeeping: drops every avatar row + file (best effort per file). */
    async deleteAllAvatar(userId: UserId): Promise<void> {
        const profile = await this.profileRepository.findOne({
            where: { user: { id: userId } },
        });
        if (!profile) return;

        const avatars = profile.avatars ?? [];
        await this.profileRepository.update(profile.id, { avatars: [] });
        for (const avatar of avatars) {
            await this.removeStoredAvatar(avatar);
        }
    }

    /**
     * Locks the caller's profile row (`FOR UPDATE`) inside an avatar
     * transaction, creating the row first when it is missing. Serializing on
     * this row is what makes the limit check + array write race-free.
     */
    private async lockProfile(
        manager: EntityManager,
        userId: UserId,
    ): Promise<LockedProfileRow> {
        await manager.query(
            `INSERT INTO "user_profiles" ("userId") VALUES ($1)
             ON CONFLICT ("userId") DO NOTHING`,
            [userId],
        );
        const rows = await manager.query<LockedProfileRow[]>(
            `SELECT "id", "avatars" FROM "user_profiles"
             WHERE "userId" = $1 FOR UPDATE`,
            [userId],
        );
        const row = rows[0];
        if (row === undefined) {
            throw new NotFoundException('profile not found');
        }
        return row;
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

    /** Removes a multer-written file; never fails the request. */
    private async removeStoredFile(filePath: string): Promise<void> {
        await fs.promises.unlink(filePath).catch((error: unknown) => {
            this.logger.warn(
                `could not remove uploaded avatar ${filePath}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        });
    }

    /** Removes a stored avatar file, resolved safely inside uploads/avatars. */
    private async removeStoredAvatar(stored: string): Promise<void> {
        const resolved = resolveAvatarFilePath(stored);
        if (resolved === null) {
            this.logger.warn(
                `refusing to delete avatar outside uploads: ${stored}`,
            );
            return;
        }
        await fs.promises.unlink(resolved).catch((error: unknown) => {
            this.logger.warn(
                `could not remove avatar file ${resolved}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        });
        // Derived artefacts: every cached size goes with the original (best
        // effort). Covers avatar delete, legacy delete and ban housekeeping,
        // which all funnel through here.
        await removeAvatarThumbnails(stored);
    }

    private async requireOwner(userId: UserId): Promise<User> {
        const owner = await this.userRepository.findOne({
            where: { id: userId },
            relations: { role: true, profile: true },
        });
        if (!owner) throw new NotFoundException('user not found');
        return owner;
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
