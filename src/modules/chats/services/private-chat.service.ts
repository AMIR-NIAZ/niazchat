import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { ChatSeen } from '../entities/chats_seen.entity';
import { Message } from 'src/modules/messages/entities/message.entity';
import { RoleChat } from '../entities/role_chat.entity';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { User } from 'src/modules/auth/entities/user.entity';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { isUniqueViolation, pairKeyOf } from '../utils/private-chat.util';
import { VisibilityService } from 'src/modules/visibility/visibility.service';
import { sanitizeUserForViewer } from 'src/modules/visibility/visibility.util';

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
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        private readonly visibility: VisibilityService,
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

        const peer = toPeerDto(target);
        return {
            chatId: Number(chat.id),
            created,
            peer: sanitizeUserForViewer(
                peer,
                await this.visibility.isBlockedBy(
                    Number(caller.sub),
                    Number(targetUserId),
                ),
            ),
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

    /**
     * "Delete chat for me": hides the conversation and its history from THIS
     * member only. Persisted as `chat_members.clearedBeforeId` (the id of the
     * newest message at deletion time); nothing is deleted for the peer and the
     * peer receives no event.
     *
     * Restore policy (documented, identical for every recipient): the chat
     * reappears in this member's list as soon as a NEW message (from either
     * side) has an id above the marker, and only messages above the marker are
     * returned by history. The marker is never cleared implicitly, so old
     * history cannot reappear later.
     */
    async deleteForMe(
        chatId: ChatId,
        callerId: UserId,
    ): Promise<{ chatId: number; clearedBeforeId: number | null }> {
        await this.assertPrivateMembership(chatId, callerId);

        return this.dataSource.transaction(async (manager) => {
            // Serialize concurrent deletes/sends for this chat so the boundary
            // and the "newest message" snapshot cannot skew.
            await manager.query('SELECT pg_advisory_xact_lock($1)', [
                Number(chatId),
            ]);

            const latest = await manager.getRepository(Message).findOne({
                where: { chat: { id: chatId } },
                order: { id: 'DESC' },
                select: { id: true },
            });
            const boundary = latest === null ? null : Number(latest.id);

            await manager
                .getRepository(ChatMember)
                .update(
                    { chat: { id: chatId }, user: { id: callerId } },
                    { clearedBeforeId: boundary },
                );
            // The caller's read position is meaningless behind the new
            // boundary; clearing it keeps future unread counts honest.
            await manager.getRepository(ChatSeen).delete({
                chat: { id: chatId },
                user: { id: callerId },
            });

            return { chatId: Number(chatId), clearedBeforeId: boundary };
        });
    }

    /**
     * "Delete chat for both": irreversibly removes the private chat row and,
     * through `ON DELETE CASCADE`, every message, attachment row, membership
     * and read position of BOTH participants. Either participant may delete;
     * membership is re-checked inside (never trusting the socket guard alone).
     *
     * Idempotent: a repeat/concurrent request finds no row (or deletes 0 rows)
     * and reports success, so the two clients converge on the same state.
     */
    async deleteForBoth(
        chatId: ChatId,
        callerId: UserId,
    ): Promise<{
        chatId: number;
        memberIds: number[];
        alreadyDeleted: boolean;
    }> {
        // A missing chat means an earlier (or concurrent) delete already won:
        // answer success so both clients converge. A GROUP id is never a valid
        // target for this private-only action.
        const chat = await this.chatRepository.findOne({
            where: { id: chatId },
            select: { id: true, type: true },
        });
        if (!chat) {
            return {
                chatId: Number(chatId),
                memberIds: [],
                alreadyDeleted: true,
            };
        }
        if (chat.type !== TypeChatEnum.PRIVATE) {
            throw new BadRequestException(
                'This action is only available in private chats',
            );
        }

        const members = await this.memberRepository.find({
            where: { chat: { id: chatId } },
            relations: { user: true },
            select: { id: true, user: { id: true } },
        });
        const memberIds = [
            ...new Set(members.map((member) => Number(member.user.id))),
        ];
        if (!memberIds.includes(Number(callerId))) {
            throw new ForbiddenException('you are not a member of this chat');
        }

        const affected = await this.dataSource.transaction(
            async (manager): Promise<number> => {
                await manager.query('SELECT pg_advisory_xact_lock($1)', [
                    Number(chatId),
                ]);
                const result = await manager
                    .getRepository(Chat)
                    .delete({ id: chatId, type: TypeChatEnum.PRIVATE });
                return result.affected ?? 0;
            },
        );

        return {
            chatId: Number(chatId),
            memberIds,
            alreadyDeleted: affected === 0,
        };
    }

    /** Private chat + active membership, or the matching 4xx. */
    private async assertPrivateMembership(
        chatId: ChatId,
        callerId: UserId,
    ): Promise<void> {
        const chat = await this.chatRepository.findOne({
            where: { id: chatId },
            select: { id: true, type: true, isBan: true },
        });
        if (!chat) throw new NotFoundException('chat not found');
        if (chat.type !== TypeChatEnum.PRIVATE) {
            throw new BadRequestException(
                'This action is only available in private chats',
            );
        }
        if (chat.isBan) {
            throw new BadRequestException('This chat is unavailable');
        }
        const member = await this.memberRepository.findOne({
            where: { chat: { id: chatId }, user: { id: callerId } },
            select: { id: true },
        });
        if (!member) {
            throw new ForbiddenException('you are not a member of this chat');
        }
    }

    private createRateKey(userId: number): string {
        const bucket = Math.floor(
            Date.now() / (PRIVATE_CHAT_CREATE_WINDOW_SECONDS * 1000),
        );
        return `private-chat:create:${userId}:${bucket}`;
    }
}
