import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { RoleChat } from '../entities/role_chat.entity';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { User } from 'src/modules/auth/entities/user.entity';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { isUniqueViolation, pairKeyOf } from '../utils/private-chat.util';

/** Private-chat peer projection: never includes a phone number. */
export interface PeerDto {
    id: number;
    name: string;
    username: string;
    /** Current photo only (backend convention: `avatars[0]`). */
    avatars: string[];
    isOnline: boolean;
    lastSeen: Date | string | null;
}

export const PRIVATE_CHAT_CREATE_LIMIT = 30;
export const PRIVATE_CHAT_CREATE_WINDOW_SECONDS = 60 * 60;

export function toPeerDto(
    user: Pick<User, 'id' | 'isOnline' | 'lastSeen'> & {
        profile?: {
            name: string | null;
            username: string | null;
            avatars: string[] | null;
        } | null;
    },
): PeerDto {
    const profile = user.profile ?? null;
    const current = profile?.avatars?.[0];
    return {
        id: Number(user.id),
        name: profile?.name ?? 'بدون نام',
        username: profile?.username ?? '',
        avatars: current === undefined ? [] : [current],
        isOnline: user.isOnline === true,
        lastSeen: user.lastSeen ?? null,
    };
}

@Injectable()
export class PrivateChatService {
    constructor(
        @InjectRepository(Chat)
        private readonly chatRepository: Repository<Chat>,
        @InjectRepository(RoleChat)
        private readonly roleRepository: Repository<RoleChat>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectDataSource()
        private readonly dataSource: DataSource,
        private readonly rateLimit: RateLimitService,
    ) {}

    /**
     * `POST /chats/private`: find or create the ONE chat of an unordered pair.
     * Existing chats are returned without counting against the creation limit.
     */
    async create(caller: JwtPayload, targetUserId: number) {
        if (Number(caller.sub) === Number(targetUserId)) {
            throw new BadRequestException(
                "You can't start a chat with yourself",
            );
        }

        const target = await this.userRepository.findOne({
            where: {
                id: Number(targetUserId) as UserId,
                status: UserStatusEnum.ACTIVE,
            },
            relations: { profile: true },
        });
        if (!target) {
            // Missing and non-active users answer identically: no probing.
            throw new NotFoundException('User not found');
        }

        const rateKey = this.createRateKey(Number(caller.sub));
        await this.rateLimit.assertUnderLimit(
            rateKey,
            PRIVATE_CHAT_CREATE_LIMIT,
            'Too many direct-chat creations, try again later',
        );

        const { chatId, created } = await this.ensureChat(
            Number(caller.sub),
            Number(targetUserId),
        );
        if (created) {
            await this.rateLimit.increment(
                rateKey,
                PRIVATE_CHAT_CREATE_WINDOW_SECONDS,
            );
        }

        const chat = await this.chatRepository.findOne({
            where: { id: chatId },
        });
        if (!chat) throw new NotFoundException('Chat not found');
        if (chat.isBan) {
            throw new BadRequestException('This chat is unavailable');
        }

        return {
            chatId: Number(chat.id),
            created,
            peer: toPeerDto(target),
        };
    }

    /**
     * Idempotent, race-safe "one chat per unordered pair". The UNIQUE index on
     * `pairKey` is the arbiter: a concurrent creator's insert fails with 23505,
     * its transaction rolls back, and the existing chat is fetched instead, so
     * both callers succeed with the SAME chat id.
     */
    async ensureChat(
        userA: number,
        userB: number,
    ): Promise<{ chatId: ChatId; created: boolean }> {
        const pairKey = pairKeyOf(userA, userB);

        try {
            return await this.dataSource.transaction(async (manager) => {
                const existing = await manager.getRepository(Chat).findOne({
                    where: { pairKey },
                });
                if (existing) {
                    return { chatId: existing.id, created: false };
                }
                return {
                    chatId: await this.insertChat(manager, pairKey, [
                        userA,
                        userB,
                    ]),
                    created: true,
                };
            });
        } catch (error) {
            if (!isUniqueViolation(error)) {
                throw error;
            }
            const existing = await this.chatRepository.findOne({
                where: { pairKey },
            });
            if (!existing) {
                throw error;
            }
            return { chatId: existing.id, created: false };
        }
    }

    private async insertChat(
        manager: EntityManager,
        pairKey: string,
        userIds: number[],
    ): Promise<ChatId> {
        const userRole = await manager.getRepository(RoleChat).findOne({
            where: { name: RoleChatEnum.USER },
        });
        if (!userRole) {
            throw new NotFoundException('user role not found');
        }

        const chat = await manager.getRepository(Chat).save({
            type: TypeChatEnum.PRIVATE,
            avatars: [],
            isBan: false,
            pairKey,
        });

        // Nobody is admin or manager in a private chat: both sides are `user`.
        await manager.getRepository(ChatMember).insert(
            userIds.map((userId) => ({
                chat: { id: chat.id },
                user: { id: userId },
                role: { id: userRole.id },
            })),
        );

        return chat.id;
    }

    private createRateKey(userId: number): string {
        const bucket = Math.floor(
            Date.now() / (PRIVATE_CHAT_CREATE_WINDOW_SECONDS * 1000),
        );
        return `private-chat:create:${userId}:${bucket}`;
    }
}
