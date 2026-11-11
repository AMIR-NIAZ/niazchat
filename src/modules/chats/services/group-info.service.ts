import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'node:fs';
import { basename } from 'node:path';
import sharp from 'sharp';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { ChatId, UserId } from 'src/common/types/brands.type';
import {
    avatarFileNameOf,
    resolveAvatarFilePath,
    storedAvatarPath,
} from 'src/modules/auth/utils/avatar.util';
import { removeAvatarThumbnails } from 'src/modules/media/avatar-thumbnail.util';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import {
    canEditInfo,
    ChatCallerContext,
    ChatPermissionService,
} from './chat-permission.service';
import { GroupRealtimeService } from './group-realtime.service';
import {
    sanitizeGroupDescription,
    sanitizeGroupTitle,
    UpdateGroupInfoDto,
} from '../dtos/updateGroupInfo.dto';

/** Text edits allowed per user per minute. */
export const GROUP_INFO_RATE_LIMIT = 20;
/** Photo operations allowed per user per minute. */
export const GROUP_AVATAR_RATE_LIMIT = 20;
export const GROUP_RATE_WINDOW_SECONDS = 60;
/** Maximum number of photos one group may keep (mirrored by the app). */
export const MAX_GROUP_AVATARS = 10;

/** Clear 400 message shared by the guard and the locked transaction check. */
export const GROUP_AVATAR_LIMIT_MESSAGE =
    'This group has reached the limit of 10 photos. Delete one before uploading a new photo.';

/** Thumbnail decoder bound (same as the avatar thumbnail service). */
const AVATAR_INPUT_PIXEL_LIMIT = 40_000_000;

export interface GroupInfoUpdateResponse {
    id: number;
    title: string;
    description: string | null;
    avatars: string[];
    changed: boolean;
}

export interface GroupAvatarResponse {
    id: number;
    avatars: string[];
    changed: boolean;
}

interface GroupChatValues {
    title: string;
    description: string | null;
    avatars: string[];
}

/** sharp format → the MIME type the client must have declared. */
const MIME_BY_FORMAT: Record<string, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

/**
 * "Edit group info": title + description (one PATCH transaction) and a photo
 * set of up to `MAX_GROUP_AVATARS` images (add = newest becomes current,
 * promote one to current, delete one by its stored file name).
 *
 * Authorization is the shared caller context: a non-banned member of that
 * chat, a live group, and the pure `canEditInfo` capability. Every write runs
 * in ONE transaction that locks the chat row, so concurrent edits serialize
 * and an identical request is an idempotent `changed: false` with no event.
 */
@Injectable()
export class GroupInfoService {
    constructor(
        @InjectRepository(Chat)
        private readonly chatRepository: Repository<Chat>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        private readonly dataSource: DataSource,
        private readonly permissions: ChatPermissionService,
        private readonly realtime: GroupRealtimeService,
        private readonly rateLimit: RateLimitService,
    ) {}

    async updateGroupInfo(
        chatId: ChatId,
        callerUserId: UserId,
        dto: UpdateGroupInfoDto,
    ): Promise<GroupInfoUpdateResponse> {
        if (dto.title === undefined && dto.description === undefined) {
            throw new BadRequestException(
                'provide a title and/or a description to change',
            );
        }

        await this.requireEditor(chatId, callerUserId);
        await this.rateLimit.consume(
            `group:info:${callerUserId}`,
            GROUP_INFO_RATE_LIMIT,
            GROUP_RATE_WINDOW_SECONDS,
            'Too many group info changes, please try again later',
        );

        const result = await this.dataSource.transaction(async (manager) => {
            const chat = await manager
                .getRepository(Chat)
                .createQueryBuilder('chat')
                .where('chat.id = :chatId', { chatId })
                .setLock('pessimistic_write')
                .getOne();
            this.assertEditableChat(chat);

            const current: GroupChatValues = {
                title: chat.title ?? '',
                description: chat.description ?? null,
                avatars: [...(chat.avatars ?? [])],
            };
            // The DTO already sanitizes; this second pass keeps direct service
            // calls (tests, future callers) honest and idempotent.
            const nextTitle =
                dto.title === undefined
                    ? current.title
                    : sanitizeGroupTitle(dto.title);
            const nextDescription =
                dto.description === undefined
                    ? current.description
                    : sanitizeGroupDescription(dto.description);
            if (nextTitle === '') {
                throw new BadRequestException(
                    'title must be between 1 and 64 characters',
                );
            }
            const changed =
                nextTitle !== current.title ||
                nextDescription !== current.description;

            if (changed) {
                await manager.getRepository(Chat).update(chat.id, {
                    title: nextTitle,
                    description: nextDescription,
                });
            }

            return {
                id: Number(chat.id),
                title: nextTitle,
                description: nextDescription,
                avatars: current.avatars,
                changed,
            };
        });

        if (result.changed) {
            this.notifyInfoChanged(chatId, callerUserId, result);
        }
        return result;
    }

    /**
     * Early (pre-multer) limit check used by `GroupAvatarLimitGuard` so the
     * 11th image never reaches the disk. The transaction re-checks the same
     * limit under the row lock, which is what makes concurrent uploads safe.
     */
    async assertAvatarSlot(chatId: number): Promise<void> {
        const chat = await this.chatRepository.findOne({
            where: { id: chatId as ChatId },
            select: { id: true, avatars: true },
        });
        if (chat === null) return; // the service answers 404/403 later
        if ((chat.avatars ?? []).length >= MAX_GROUP_AVATARS) {
            throw new BadRequestException(GROUP_AVATAR_LIMIT_MESSAGE);
        }
    }

    /**
     * Adds one photo as the new CURRENT photo (index 0). The new file name is
     * server-generated and the array write is one SQL UPDATE under the chat's
     * row lock, so two concurrent uploads neither lose a photo nor exceed the
     * limit. The stored file is removed again when validation or the DB write
     * fails. Every existing photo is kept.
     */
    async addGroupAvatar(
        chatId: ChatId,
        callerUserId: UserId,
        file: Express.Multer.File | undefined,
    ): Promise<GroupAvatarResponse> {
        if (file === undefined) {
            throw new BadRequestException(
                'multipart field "avatar" with an image file is required',
            );
        }

        const storedPath = storedAvatarPath(file.path);

        try {
            await this.validateUploadedImage(file);
            await this.requireEditor(chatId, callerUserId);
            await this.consumeAvatarRate(callerUserId);

            const result = await this.dataSource.transaction(
                async (manager) => {
                    const chat = await manager
                        .getRepository(Chat)
                        .createQueryBuilder('chat')
                        .where('chat.id = :chatId', { chatId })
                        .setLock('pessimistic_write')
                        .getOne();
                    this.assertEditableChat(chat);

                    const current = [...(chat.avatars ?? [])];
                    if (current.length >= MAX_GROUP_AVATARS) {
                        throw new BadRequestException(
                            GROUP_AVATAR_LIMIT_MESSAGE,
                        );
                    }
                    const avatars = [storedPath, ...current];
                    await manager
                        .getRepository(Chat)
                        .update(chat.id, { avatars });

                    return {
                        id: Number(chat.id),
                        title: chat.title ?? '',
                        avatars,
                    };
                },
            );

            this.notifyAvatarChanged(
                chatId,
                callerUserId,
                result.title,
                result.avatars,
            );

            return {
                id: result.id,
                avatars: result.avatars,
                changed: true,
            };
        } catch (error) {
            await this.removeStoredAvatar(storedPath);
            throw error;
        }
    }

    /**
     * Legacy `DELETE /chats/:chatId/group/avatar`: removes ONLY the current
     * photo (index 0). The next photo becomes current; an empty set answers
     * `changed: false` so the call is idempotent.
     */
    async removeGroupAvatar(
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<GroupAvatarResponse> {
        await this.requireEditor(chatId, callerUserId);
        await this.consumeAvatarRate(callerUserId);

        return this.removeAvatarEntry(chatId, callerUserId, null);
    }

    /**
     * Removes ONE photo identified by its stored file NAME. The name must match
     * an entry of THIS chat's array (compared by basename); a name from another
     * chat or an unknown name answers 404 and touches no file.
     */
    async removeGroupAvatarByFileName(
        chatId: ChatId,
        callerUserId: UserId,
        rawFileName: string,
    ): Promise<GroupAvatarResponse> {
        const fileName = avatarFileNameOf(rawFileName);
        if (fileName === null) {
            throw new BadRequestException('invalid photo file name');
        }

        await this.requireEditor(chatId, callerUserId);
        await this.consumeAvatarRate(callerUserId);

        return this.removeAvatarEntry(chatId, callerUserId, fileName);
    }

    /**
     * Makes one photo current by moving it to index 0 while keeping the
     * relative order of the others. Already-current answers `changed: false`.
     */
    async setMainGroupAvatar(
        chatId: ChatId,
        callerUserId: UserId,
        rawFileName: string,
    ): Promise<GroupAvatarResponse> {
        const fileName = avatarFileNameOf(rawFileName);
        if (fileName === null) {
            throw new BadRequestException('invalid photo file name');
        }

        await this.requireEditor(chatId, callerUserId);
        await this.consumeAvatarRate(callerUserId);

        const result = await this.dataSource.transaction(async (manager) => {
            const chat = await manager
                .getRepository(Chat)
                .createQueryBuilder('chat')
                .where('chat.id = :chatId', { chatId })
                .setLock('pessimistic_write')
                .getOne();
            this.assertEditableChat(chat);

            const current = [...(chat.avatars ?? [])];
            const entry = this.findEntry(current, fileName);
            if (entry === null) {
                throw new NotFoundException('photo not found');
            }
            if (current[0] === entry) {
                return {
                    id: Number(chat.id),
                    title: chat.title ?? '',
                    avatars: current,
                    changed: false,
                };
            }

            const avatars = [
                entry,
                ...current.filter((value) => value !== entry),
            ];
            await manager.getRepository(Chat).update(chat.id, { avatars });
            return {
                id: Number(chat.id),
                title: chat.title ?? '',
                avatars,
                changed: true,
            };
        });

        if (result.changed) {
            this.notifyAvatarChanged(
                chatId,
                callerUserId,
                result.title,
                result.avatars,
            );
        }
        return {
            id: result.id,
            avatars: result.avatars,
            changed: result.changed,
        };
    }

    /** Shared locked removal used by the by-name and current-photo routes. */
    private async removeAvatarEntry(
        chatId: ChatId,
        callerUserId: UserId,
        fileName: string | null,
    ): Promise<GroupAvatarResponse> {
        const result = await this.dataSource.transaction(async (manager) => {
            const chat = await manager
                .getRepository(Chat)
                .createQueryBuilder('chat')
                .where('chat.id = :chatId', { chatId })
                .setLock('pessimistic_write')
                .getOne();
            this.assertEditableChat(chat);

            const current = [...(chat.avatars ?? [])];
            if (fileName === null) {
                if (current.length === 0) {
                    return {
                        id: Number(chat.id),
                        title: chat.title ?? '',
                        avatars: current,
                        removed: null,
                        changed: false,
                    };
                }
                const removed = current[0] ?? null;
                const avatars = current.slice(1);
                await manager.getRepository(Chat).update(chat.id, { avatars });
                return {
                    id: Number(chat.id),
                    title: chat.title ?? '',
                    avatars,
                    removed,
                    changed: true,
                };
            }

            const entry = this.findEntry(current, fileName);
            if (entry === null) {
                throw new NotFoundException('photo not found');
            }
            const avatars = current.filter((value) => value !== entry);
            await manager.getRepository(Chat).update(chat.id, { avatars });
            return {
                id: Number(chat.id),
                title: chat.title ?? '',
                avatars,
                removed: entry,
                changed: true,
            };
        });

        if (!result.changed) {
            return {
                id: result.id,
                avatars: result.avatars,
                changed: false,
            };
        }

        if (result.removed !== null) {
            // File and cached thumbnails are derived artefacts: cleanup is
            // best effort and never fails the request.
            await this.removeStoredAvatar(result.removed);
        }
        this.notifyAvatarChanged(
            chatId,
            callerUserId,
            result.title,
            result.avatars,
        );
        return {
            id: result.id,
            avatars: result.avatars,
            changed: true,
        };
    }

    /** Matches a stored entry by its basename (never by array index). */
    private findEntry(entries: string[], fileName: string): string | null {
        return entries.find((value) => basename(value) === fileName) ?? null;
    }

    private async consumeAvatarRate(callerUserId: UserId): Promise<void> {
        await this.rateLimit.consume(
            `group:avatar:${callerUserId}`,
            GROUP_AVATAR_RATE_LIMIT,
            GROUP_RATE_WINDOW_SECONDS,
            'Too many group photo changes, please try again later',
        );
    }

    /** Caller context + group/ban/capability gates, shared by every write. */
    private async requireEditor(
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<ChatCallerContext> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        this.assertCanEdit(caller);
        return caller;
    }

    private assertCanEdit(caller: ChatCallerContext): void {
        if (!canEditInfo(caller)) {
            throw new ForbiddenException(
                "You don't have permission to do this",
            );
        }
    }

    /**
     * Re-checks the chat inside the locked transaction. A row that vanished,
     * stopped being a group or became banned answers 404/400/403, never 500.
     */
    private assertEditableChat(chat: Chat | null): asserts chat is Chat {
        if (chat === null || chat === undefined) {
            throw new NotFoundException('group not found');
        }
        if (chat.type !== TypeChatEnum.GRUPE) {
            throw new BadRequestException(
                'This action is only available in groups',
            );
        }
        if (chat.isBan) {
            throw new ForbiddenException('this chat has been banned');
        }
    }

    /**
     * Content-based validation (the declared MIME is never trusted): `sharp`
     * must decode the bytes as jpeg/png/webp, the detected type must match the
     * declared type, dimensions must be positive and the pixel count bounded.
     */
    private async validateUploadedImage(
        file: Express.Multer.File,
    ): Promise<void> {
        const declared = (file.mimetype ?? '').toLowerCase();
        const normalizedDeclared =
            declared === 'image/jpg' ? 'image/jpeg' : declared;

        let format: string | undefined;
        let width = 0;
        let height = 0;
        try {
            const metadata = await sharp(file.path, {
                limitInputPixels: AVATAR_INPUT_PIXEL_LIMIT,
                failOn: 'error',
            }).metadata();
            format = metadata.format;
            width = metadata.width ?? 0;
            height = metadata.height ?? 0;
        } catch {
            throw new BadRequestException(
                'avatar file content is not a supported image (jpeg, png, webp)',
            );
        }

        const detected = format === undefined ? null : MIME_BY_FORMAT[format];
        if (
            detected === null ||
            detected !== normalizedDeclared ||
            width <= 0 ||
            height <= 0
        ) {
            throw new BadRequestException(
                'avatar file content is not a supported image (jpeg, png, webp)',
            );
        }
    }

    /** Removes one stored photo and every cached thumbnail (best effort). */
    private async removeStoredAvatar(stored: string): Promise<void> {
        const resolved = resolveAvatarFilePath(stored);
        if (resolved !== null) {
            await fs.promises.unlink(resolved).catch((): void => undefined);
        }
        await removeAvatarThumbnails(stored);
    }

    private notifyInfoChanged(
        chatId: ChatId,
        callerUserId: UserId,
        values: GroupChatValues,
    ): void {
        this.realtime.groupInfoChanged(chatId, callerUserId);
        void this.notifyGroupUpdated(chatId, values.title, values.avatars);
    }

    private notifyAvatarChanged(
        chatId: ChatId,
        callerUserId: UserId,
        title: string,
        avatars: string[],
    ): void {
        this.realtime.groupAvatarsChanged(chatId, callerUserId);
        void this.notifyGroupUpdated(chatId, title, avatars);
    }

    /**
     * `group:updated { chatId, title, avatars }` to every member's personal
     * room, so chat lists and open chats refresh title/photo without a full
     * refetch. Failures never affect the response.
     */
    private async notifyGroupUpdated(
        chatId: ChatId,
        title: string,
        avatars: string[],
    ): Promise<void> {
        try {
            const rows = await this.memberRepository.query<
                Array<{ userId: string | number }>
            >(
                `SELECT DISTINCT "userId" FROM "chat_members" WHERE "chatId" = $1`,
                [chatId],
            );
            this.realtime.groupUpdated(
                chatId,
                title,
                avatars,
                rows.map((row) => Number(row.userId)),
            );
        } catch {
            // Realtime fan-out is best effort.
        }
    }
}
