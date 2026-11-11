import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { num } from 'src/common/utils/ws-serializer.utils';
import { UserProfile } from 'src/modules/auth/entities/user_profile.entity';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { Link } from '../entities/link.entity';
import { RoleChat } from '../entities/role_chat.entity';
import {
    canManageInviteLinks,
    ChatCallerContext,
    ChatPermissionService,
} from './chat-permission.service';
import { GroupRealtimeService } from './group-realtime.service';
import {
    computeInviteStatus,
    generateInviteCode,
    INVITE_BANNED_MESSAGE,
    INVITE_FORBIDDEN_MESSAGE,
    INVITE_INVALID_MESSAGE,
    INACTIVE_INVITE_LINKS_LIMIT,
    isInviteCode,
    isInviteUsable,
    isUniqueViolation,
    MAX_ACTIVE_INVITE_LINKS,
    type InviteLinkStatus,
} from '../utils/invite-link.util';

export interface InviteLinkItem {
    id: number;
    code: string;
    status: InviteLinkStatus;
    createdBy: { userId: number | null; name: string };
    createdAt: Date;
    expiresAt: string | null;
    maxUses: number | null;
    usesCount: number;
    revokedAt: string | null;
}

export interface InviteLinksResponse {
    items: InviteLinkItem[];
    activeCount: number;
    maxActive: number;
}

export interface InviteLinkRevokeResponse {
    id: number;
    status: 'revoked';
    changed: boolean;
}

export interface InvitePreviewResponse {
    title: string;
    description: string | null;
    avatar: string | null;
    membersCount: number;
    alreadyMember: boolean;
    chatId: number | null;
}

export interface JoinInviteResponse {
    chatId: number;
    title: string;
    joined: boolean;
    alreadyMember: boolean;
}

interface CreateInviteLinkInput {
    expiresInSeconds?: number | null;
    maxUses?: number | null;
}

const MANAGE_LIMIT = 30;
const JOIN_LIMIT = 20;
const PREVIEW_LIMIT = 30;
const RATE_WINDOW_SECONDS = 60;

/**
 * Invite links: owner/admin management plus the public preview/join pair.
 *
 * Manage operations re-check membership, group type, chat ban and the
 * capability inside the transaction (the pre-check gives fast 4xx responses).
 * Create locks the chat row so concurrent creations cannot exceed the active
 * limit. Join locks the link row, dedupes membership rows by user, and bumps
 * `usesCount` with a conditional UPDATE so `maxUses` cannot be overshot.
 */
@Injectable()
export class GroupInviteLinksService {
    constructor(
        @InjectRepository(Link)
        private readonly linkRepository: Repository<Link>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(UserProfile)
        private readonly profileRepository: Repository<UserProfile>,
        private readonly dataSource: DataSource,
        private readonly permissions: ChatPermissionService,
        private readonly realtime: GroupRealtimeService,
        private readonly rateLimit: RateLimitService,
    ) {}

    // ── management ─────────────────────────────────────────────────────────

    async listLinks(
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<InviteLinksResponse> {
        await this.assertManager(chatId, callerUserId);
        await this.consumeManage(callerUserId);

        const now = new Date();
        const [active, inactive] = await Promise.all([
            this.activeLinks(chatId, now),
            this.inactiveLinks(chatId, now),
        ]);
        const items = [...active, ...inactive];
        const names = await this.createdByNames(
            items
                .map((link) => link.createdByUserId)
                .filter((value): value is string | number => value !== null),
        );

        return {
            items: items.map((link) => this.serialize(link, names, now)),
            activeCount: active.length,
            maxActive: MAX_ACTIVE_INVITE_LINKS,
        };
    }

    async createLink(
        chatId: ChatId,
        callerUserId: UserId,
        input: CreateInviteLinkInput,
    ): Promise<InviteLinkItem> {
        await this.assertManager(chatId, callerUserId);
        await this.consumeManage(callerUserId);

        const maxUses = input.maxUses ?? null;
        const expiresInSeconds = input.expiresInSeconds ?? null;
        let lastError: unknown = null;

        // A code collision aborts the transaction, so retry the whole block.
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const code = generateInviteCode();
            try {
                const saved = await this.dataSource.transaction(
                    async (manager): Promise<Link> => {
                        await this.assertLockedManager(
                            manager,
                            chatId,
                            callerUserId,
                        );

                        if (
                            (await this.countActive(manager, chatId)) >=
                            MAX_ACTIVE_INVITE_LINKS
                        ) {
                            throw new ConflictException(
                                'Too many active invite links. Revoke one first.',
                            );
                        }

                        const expiresAt =
                            expiresInSeconds === null
                                ? null
                                : new Date(
                                      Date.now() + expiresInSeconds * 1000,
                                  );
                        return manager.getRepository(Link).save({
                            code,
                            chat: { id: chatId },
                            createdByUserId: String(callerUserId),
                            maxUses,
                            usesCount: 0,
                            usageLimit: maxUses ?? 0,
                            usageCount: 0,
                            expiresAt,
                            revokedAt: null,
                            isActive: true,
                        });
                    },
                );

                this.realtime.groupChanged(
                    chatId,
                    'invite_links_changed',
                    callerUserId,
                );
                const names = await this.createdByNames([
                    saved.createdByUserId as string | number,
                ]);
                return this.serialize(saved, names, new Date());
            } catch (error) {
                lastError = error;
                if (!isUniqueViolation(error) || attempt === 2) {
                    throw error;
                }
            }
        }

        throw new ConflictException(
            `Could not create an invite link: ${String(lastError)}`,
        );
    }

    async revokeLink(
        chatId: ChatId,
        linkId: number,
        callerUserId: UserId,
    ): Promise<InviteLinkRevokeResponse> {
        await this.assertManager(chatId, callerUserId);
        await this.consumeManage(callerUserId);

        const result = await this.dataSource.transaction(
            async (manager): Promise<InviteLinkRevokeResponse> => {
                await this.assertLockedManager(
                    manager,
                    chatId,
                    callerUserId,
                );

                const link = await manager
                    .getRepository(Link)
                    .createQueryBuilder('l')
                    .where('l.id = :linkId', { linkId })
                    .andWhere('l."chatId" = :chatId', { chatId })
                    .setLock('pessimistic_write')
                    .getOne();
                if (link === null) {
                    throw new NotFoundException('Invite link not found');
                }

                if (link.revokedAt !== null || link.isActive === false) {
                    return {
                        id: Number(link.id),
                        status: 'revoked',
                        changed: false,
                    };
                }

                link.revokedAt = new Date();
                link.isActive = false;
                await manager.getRepository(Link).save(link);
                return {
                    id: Number(link.id),
                    status: 'revoked',
                    changed: true,
                };
            },
        );

        if (result.changed) {
            this.realtime.groupChanged(
                chatId,
                'invite_links_changed',
                callerUserId,
            );
        }
        return result;
    }

    // ── join side ──────────────────────────────────────────────────────────

    async preview(
        code: string,
        callerUserId: UserId,
    ): Promise<InvitePreviewResponse> {
        this.assertCode(code);
        await this.rateLimit.consume(
            `group:invite:preview:${callerUserId}`,
            PREVIEW_LIMIT,
            RATE_WINDOW_SECONDS,
            'Too many invite link previews, please try again later',
        );

        const link = await this.linkRepository.findOne({
            where: { code },
            relations: { chat: true },
        });
        if (link === null || !this.linkIsUsable(link, link.chat)) {
            throw this.invalidLink();
        }

        const rows = await this.memberRows(link.chat.id, callerUserId);
        if (this.hasBanRow(rows)) {
            throw new ForbiddenException(INVITE_BANNED_MESSAGE);
        }

        const alreadyMember = rows.length > 0;
        return {
            title: link.chat.title ?? '',
            description: link.chat.description ?? null,
            avatar: Array.isArray(link.chat.avatars)
                ? (link.chat.avatars[0] ?? null)
                : null,
            membersCount: await this.membersCount(link.chat.id),
            alreadyMember,
            chatId: alreadyMember ? Number(link.chat.id) : null,
        };
    }

    async joinByCode(
        code: string,
        callerUserId: UserId,
    ): Promise<JoinInviteResponse> {
        this.assertCode(code);
        await this.rateLimit.consume(
            `group:invite:join:${callerUserId}`,
            JOIN_LIMIT,
            RATE_WINDOW_SECONDS,
            'Too many join attempts, please try again later',
        );

        const result = await this.dataSource.transaction(
            async (
                manager,
            ): Promise<JoinInviteResponse & { wasNew: boolean }> => {
                const link = await manager
                    .getRepository(Link)
                    .createQueryBuilder('l')
                    .innerJoinAndSelect('l.chat', 'chat')
                    .where('l.code = :code', { code })
                    .setLock('pessimistic_write')
                    .getOne();
                if (link === null || !this.linkIsUsable(link, link.chat)) {
                    throw this.invalidLink();
                }

                const rows = await manager.getRepository(ChatMember).find({
                    where: {
                        chat: { id: link.chat.id },
                        user: { id: callerUserId },
                    },
                    relations: { role: true },
                });
                if (this.hasBanRow(rows)) {
                    throw new ForbiddenException(INVITE_BANNED_MESSAGE);
                }
                const title = link.chat.title ?? '';
                if (rows.length > 0) {
                    return {
                        chatId: Number(link.chat.id),
                        title,
                        joined: false,
                        alreadyMember: true,
                        wasNew: false,
                    };
                }

                const role = await manager
                    .getRepository(RoleChat)
                    .findOne({ where: { name: RoleChatEnum.USER } });
                if (role === null) {
                    throw new InternalServerErrorException(
                        'user role is not seeded',
                    );
                }
                await manager.getRepository(ChatMember).insert({
                    chat: { id: link.chat.id },
                    user: { id: callerUserId },
                    role: { id: role.id },
                });

                // Conditional increment: verifies the link still admits a use.
                const updated = await manager.query<
                    Array<{ count: string | number }>
                >(
                    `WITH updated AS (
                        UPDATE "link"
                           SET "usesCount" = "usesCount" + 1,
                               "usageCount" = "usageCount" + 1
                         WHERE id = $1
                           AND "revokedAt" IS NULL
                           AND "isActive" = true
                           AND ("expiresAt" IS NULL OR "expiresAt" > now())
                           AND ("maxUses" IS NULL OR "usesCount" < "maxUses")
                        RETURNING id
                    )
                    SELECT COUNT(*)::int AS count FROM updated`,
                    [link.id],
                );
                if (Number(updated[0]?.count ?? 0) !== 1) {
                    // Rolls back the member insert: the link filled up meanwhile.
                    throw this.invalidLink();
                }

                return {
                    chatId: Number(link.chat.id),
                    title,
                    joined: true,
                    alreadyMember: false,
                    wasNew: true,
                };
            },
        );

        if (result.wasNew) {
            this.realtime.groupChanged(
                result.chatId,
                'member_joined',
                callerUserId,
            );
            this.realtime.groupAdded(result.chatId, callerUserId);
            void this.notifyMembersCount(result.chatId);
        }
        return {
            chatId: result.chatId,
            title: result.title,
            joined: result.joined,
            alreadyMember: result.alreadyMember,
        };
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private assertCode(code: string): void {
        if (!isInviteCode(code)) {
            throw this.invalidLink();
        }
    }

    private invalidLink(): NotFoundException {
        return new NotFoundException(INVITE_INVALID_MESSAGE);
    }

    private linkIsUsable(link: Link, chat: Chat): boolean {
        return (
            chat.type === TypeChatEnum.GRUPE &&
            chat.isBan !== true &&
            isInviteUsable(link, new Date())
        );
    }

    private async assertManager(
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<ChatCallerContext> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        if (!canManageInviteLinks(caller)) {
            throw new ForbiddenException(INVITE_FORBIDDEN_MESSAGE);
        }
        return caller;
    }

    private consumeManage(callerUserId: UserId): Promise<number> {
        return this.rateLimit.consume(
            `group:invite:manage:${callerUserId}`,
            MANAGE_LIMIT,
            RATE_WINDOW_SECONDS,
            'Too many invite link actions, please try again later',
        );
    }

    /** Re-checks the caller, group type and ban state under FOR UPDATE. */
    private async assertLockedManager(
        manager: EntityManager,
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<void> {
        const chat = await manager.getRepository(Chat).findOne({
            where: { id: chatId },
            lock: { mode: 'pessimistic_write' },
        });
        if (chat === null) {
            throw new NotFoundException('Chat not found');
        }
        if (chat.type !== TypeChatEnum.GRUPE) {
            throw new BadRequestException(
                'This action is only available in groups',
            );
        }
        if (chat.isBan) {
            throw new ForbiddenException('this chat has been banned');
        }

        const rows = await manager
            .getRepository(ChatMember)
            .createQueryBuilder('m')
            .innerJoinAndSelect('m.role', 'role')
            .where('m."chatId" = :chatId', { chatId })
            .andWhere('m."userId" = :userId', { userId: callerUserId })
            .setLock('pessimistic_write')
            .getMany();
        const role = this.bestRoleName(rows);
        if (role === null) {
            throw new ForbiddenException(
                'you are not a member of this group',
            );
        }
        if (role === RoleChatEnum.BAN) {
            throw new ForbiddenException(
                'you have been banned from this group',
            );
        }
        if (
            role !== RoleChatEnum.MANAGER &&
            role !== RoleChatEnum.ADMIN
        ) {
            throw new ForbiddenException(INVITE_FORBIDDEN_MESSAGE);
        }
    }

    private bestRoleName(rows: ChatMember[]): RoleChatEnum | null {
        if (rows.length === 0) return null;
        const rank = (name: string | undefined): number => {
            if (name === RoleChatEnum.MANAGER) return 3;
            if (name === RoleChatEnum.ADMIN) return 2;
            if (name === RoleChatEnum.USER) return 1;
            return 0;
        };
        const best = rows.reduce((current, candidate) =>
            rank(candidate.role?.name) > rank(current.role?.name)
                ? candidate
                : current,
        );
        return (best.role?.name ?? null) as RoleChatEnum | null;
    }

    private hasBanRow(rows: ChatMember[]): boolean {
        return rows.some((row) => row.role?.name === RoleChatEnum.BAN);
    }

    private memberRows(
        chatId: ChatId,
        userId: UserId,
    ): Promise<ChatMember[]> {
        return this.memberRepository.find({
            where: { chat: { id: chatId }, user: { id: userId } },
            relations: { role: true },
        });
    }

    private async activeLinks(chatId: ChatId, now: Date): Promise<Link[]> {
        return this.linkRepository
            .createQueryBuilder('l')
            .where('l."chatId" = :chatId', { chatId })
            .andWhere(
                `l."isActive" = true
                 AND l."revokedAt" IS NULL
                 AND (l."expiresAt" IS NULL OR l."expiresAt" > :now)
                 AND (l."maxUses" IS NULL OR l."usesCount" < l."maxUses")`,
                { now },
            )
            .orderBy('l."createdAt"', 'DESC')
            .addOrderBy('l.id', 'DESC')
            .getMany();
    }

    private async inactiveLinks(chatId: ChatId, now: Date): Promise<Link[]> {
        return this.linkRepository
            .createQueryBuilder('l')
            .where('l."chatId" = :chatId', { chatId })
            .andWhere(
                `(l."isActive" = false
                  OR l."revokedAt" IS NOT NULL
                  OR (l."expiresAt" IS NOT NULL AND l."expiresAt" <= :now)
                  OR (l."maxUses" IS NOT NULL AND l."usesCount" >= l."maxUses"))`,
                { now },
            )
            .orderBy('l."createdAt"', 'DESC')
            .addOrderBy('l.id', 'DESC')
            .limit(INACTIVE_INVITE_LINKS_LIMIT)
            .getMany();
    }

    private async countActive(
        manager: EntityManager,
        chatId: ChatId,
    ): Promise<number> {
        const rows = await manager.query<Array<{ count: string | number }>>(
            `SELECT COUNT(*)::int AS count
               FROM "link" l
              WHERE l."chatId" = $1
                AND l."isActive" = true
                AND l."revokedAt" IS NULL
                AND (l."expiresAt" IS NULL OR l."expiresAt" > now())
                AND (l."maxUses" IS NULL OR l."usesCount" < l."maxUses")`,
            [chatId],
        );
        return Number(rows[0]?.count ?? 0);
    }

    private serialize(
        link: Link,
        names: Map<number, string>,
        now: Date,
    ): InviteLinkItem {
        const createdById =
            link.createdByUserId === null ||
            link.createdByUserId === undefined
                ? null
                : Number(link.createdByUserId);
        return {
            id: num(link.id),
            code: link.code,
            status: computeInviteStatus(link, now),
            createdBy: {
                userId: createdById,
                name:
                    createdById === null
                        ? ''
                        : (names.get(createdById) ?? ''),
            },
            createdAt: link.createdAt,
            expiresAt:
                link.expiresAt === null
                    ? null
                    : new Date(link.expiresAt).toISOString(),
            maxUses: link.maxUses ?? null,
            usesCount: Number(link.usesCount ?? 0),
            revokedAt:
                link.revokedAt === null
                    ? null
                    : new Date(link.revokedAt).toISOString(),
        };
    }

    private async createdByNames(
        ids: Array<string | number>,
    ): Promise<Map<number, string>> {
        const unique = [...new Set(ids.map((id) => Number(id)))].filter(
            (id) => Number.isFinite(id) && id > 0,
        );
        if (unique.length === 0) return new Map();
        const rows = await this.profileRepository.query<
            Array<{ userId: string | number; name: string | null }>
        >(
            `SELECT p."userId" AS "userId", p.name AS name
               FROM user_profiles p
              WHERE p."userId" = ANY($1::bigint[])`,
            [unique],
        );
        return new Map(
            rows.map((row) => [Number(row.userId), row.name ?? ''] as const),
        );
    }

    private async membersCount(chatId: ChatId): Promise<number> {
        const rows = await this.memberRepository.query<
            Array<{ count: string | number }>
        >(
            `SELECT COUNT(DISTINCT m."userId")::int AS count
               FROM chat_members m
               JOIN role_chat r ON r.id = m."roleId"
              WHERE m."chatId" = $1 AND r.name <> 'ban'`,
            [chatId],
        );
        return Number(rows[0]?.count ?? 0);
    }

    private async notifyMembersCount(chatId: number): Promise<void> {
        try {
            this.realtime.membersCountChanged(
                chatId,
                await this.membersCount(chatId as ChatId),
            );
        } catch {
            // The next joinChat reloads the authoritative count.
        }
    }
}
