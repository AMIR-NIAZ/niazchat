import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { createChatDto } from '../dtos/createChat.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Chat } from '../entities/chat.entity';
import { In, Not, Repository } from 'typeorm';
import { ChatMember } from '../entities/chat_members.entity';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { ChatSeen } from '../entities/chats_seen.entity';
import { Message } from 'src/modules/messages/entities/message.entity';
import * as fs from 'fs';
import { RoleChat } from '../entities/role_chat.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { User } from 'src/modules/auth/entities/user.entity';
import { ChatAccessService, ChatCallerContext } from './chat-access.service';
import { GroupRealtimeService } from './group-realtime.service';
import { removeAvatarThumbnails } from 'src/modules/media/avatar-thumbnail.util';
import { PeerDto, toPeerDto } from './private-chat.service';
import { isChatVisibleInList } from '../utils/private-chat.util';

export interface ChatMemberPageOptions {
    search?: string;
    limit?: number;
    cursor?: number;
}

/** A chat-list row plus the caller's unread count (capped at `UNREAD_CAP`). */
export type ChatWithUnread = Chat & {
    unreadCount: number;
    /** Other participant's display name for private chats (older clients). */
    peerName?: string | null;
    /** Other participant (never a phone number) on private chats. */
    peer?: PeerDto | null;
};

/** Server-side cap for `unreadCount`; the app renders "99+" above 99. */
export const UNREAD_CAP = 100;

export interface ChatSeenState {
    /** Stored before the current join; null when the caller never read. */
    myLastSeenId: number | null;
    /** Highest `lastSeenId` among the OTHER non-banned members. */
    othersLastSeenId: number | null;
}

export interface MarkSeenResult {
    /** Effective stored value (never lower than what was there before). */
    lastSeenId: number;
    changed: boolean;
}

@Injectable()
export class ChatService {
    constructor(
        @InjectRepository(Chat)
        private readonly chatRepository: Repository<Chat>,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(ChatSeen)
        private readonly seenRepository: Repository<ChatSeen>,
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(RoleChat)
        private readonly roleChatRepository: Repository<RoleChat>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly access: ChatAccessService,
        private readonly groupRealtime: GroupRealtimeService,
    ) {}

    async createGroup(dto: createChatDto, user: JwtPayload) {
        const { title, members = [] } = dto;

        const uniqueMembers = [...new Set(members)].filter(
            (id) => id !== String(user.sub),
        );

        const chat = await this.chatRepository.save({
            title,
            type: TypeChatEnum.GRUPE,
        });

        const userRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.USER },
        });

        const managerRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.MANAGER },
        });

        if (!userRole || !managerRole) {
            throw new NotFoundException('role not found');
        }

        // The creator owns the group (`manager`); everyone else joins as `user`.
        const allMembers = [
            {
                chat: { id: chat.id },
                user: { id: user.sub },
                role: { id: managerRole.id },
            },
            ...uniqueMembers.map((id) => ({
                chat: { id: chat.id },
                user: { id },
                role: { id: userRole.id },
            })),
        ];

        await this.memberRepository.insert(allMembers);

        return { message: 'group created successfully' };
    }

    async addMemberByPhone(chatId: ChatId, userPhone: string) {
        const user = await this.userRepository.findOne({
            where: { phone: userPhone },
        });

        if (!user) {
            throw new NotFoundException('user not found');
        }

        const chat = await this.chatRepository.findOne({
            where: { id: chatId },
        });

        if (!chat) {
            throw new NotFoundException('chat not found');
        }

        const existingMember = await this.memberRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: user.id },
            },
            relations: { role: true },
        });

        if (existingMember) {
            if (existingMember.role?.name === RoleChatEnum.BAN) {
                throw new ConflictException(
                    'user is banned from this group and cannot be added',
                );
            }
            throw new ConflictException('user is already a member');
        }

        const userRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.USER },
        });

        if (!userRole) {
            throw new NotFoundException('role not found');
        }

        const member = this.memberRepository.create({
            chat,
            user,
            role: userRole,
        });

        await this.memberRepository.save(member);

        const wireMember = this.serializeMember(member, user, false);
        this.groupRealtime.groupAdded(chatId, user.id);
        this.groupRealtime.groupChanged(chatId, 'member_joined');
        await this.notifyMembersCount(chatId);

        return {
            message: 'user added successfully',
            member: wireMember,
        };
    }

    async getUserChats(user: JwtPayload): Promise<ChatWithUnread[]> {
        // `member.role` is joined so the caller's own banned membership hides
        // the group entirely (role, not a flag, marks a ban). LEFT join: a
        // legacy private chat may have no role row and must still be listed.
        const memberships = await this.memberRepository
            .createQueryBuilder('member')
            .leftJoinAndSelect('member.role', 'memberRole')
            .innerJoinAndSelect('member.chat', 'chat')
            .leftJoinAndMapOne(
                'chat.lastMessage',
                Message,
                'lm',
                `lm.id = (
                SELECT MAX(m2.id) FROM messages m2
                WHERE m2."chatId" = chat.id AND m2."isDeleted" = false
            )`,
            )
            // `serializeChat` puts `senderId` on the wire; the sender must be
            // loaded (attachments stay unloaded — serialized as []).
            .leftJoinAndSelect('lm.sender', 'lmSender')
            .where('member.user.id = :userId', { userId: user.sub })
            .andWhere('chat.isBan = :isban', { isban: false })
            .andWhere(
                '(memberRole.name IS NULL OR memberRole.name != :banRole)',
                {
                    banRole: RoleChatEnum.BAN,
                },
            )
            .getMany();

        const byId = new Map<string, Chat>();
        for (const m of memberships) byId.set(String(m.chat.id), m.chat);

        const activity = (c: Chat): number =>
            new Date(c.lastMessage?.createdAt ?? c.createdAt).getTime();

        // ONE grouped query for the whole list (no N+1): count non-own,
        // non-deleted messages newer than the caller's stored read position.
        const unread = await this.getUnreadCounts(user.sub);

        // Empty private chats stay out of both lists until the first message
        // exists; deleting that message keeps the chat visible (`messages` rows
        // are soft-deleted, never removed). ONE grouped query, no per-chat hit.
        const privateIds = [...byId.values()]
            .filter((chat) => chat.type === TypeChatEnum.PRIVATE)
            .map((chat) => chat.id);
        const withAnyMessage = await this.getChatIdsWithAnyMessage(privateIds);
        const visible = [...byId.values()].filter((chat) =>
            isChatVisibleInList(chat.type, withAnyMessage.has(String(chat.id))),
        );

        // ONE query for every peer (other member + profile), never one per chat.
        const peers = await this.getPeersForChats(
            visible
                .filter((chat) => chat.type === TypeChatEnum.PRIVATE)
                .map((chat) => chat.id),
            user.sub,
        );

        return visible
            .sort((a, b) => activity(b) - activity(a))
            .map((chat) => {
                const peer = peers.get(String(chat.id)) ?? null;
                return Object.assign(chat, {
                    unreadCount: Math.min(
                        unread.get(String(chat.id)) ?? 0,
                        UNREAD_CAP,
                    ),
                    peer,
                    peerName: peer?.name ?? null,
                });
            });
    }

    /** Chat ids that have at least one row in `messages`, deleted included. */
    private async getChatIdsWithAnyMessage(
        chatIds: ChatId[],
    ): Promise<Set<string>> {
        if (chatIds.length === 0) return new Set();
        const rows = await this.messageRepository
            .createQueryBuilder('message')
            .select('DISTINCT message.chatId', 'chatId')
            .where('message.chatId IN (:...chatIds)', { chatIds })
            .getRawMany<{ chatId: string }>();
        return new Set(rows.map((row) => String(row.chatId)));
    }

    /**
     * Peers for a batch of private chats in ONE query (join the other member
     * and their profile). Keyed by a string chat id to match Map usage.
     */
    async getPeersForChats(
        chatIds: ChatId[],
        callerId: number,
    ): Promise<Map<string, PeerDto>> {
        const peers = new Map<string, PeerDto>();
        if (chatIds.length === 0) return peers;
        const rows = await this.memberRepository.find({
            where: {
                chat: { id: In(chatIds) },
                user: { id: Not(callerId) as unknown as UserId },
            },
            relations: { chat: true, user: { profile: true } },
        });
        for (const row of rows) {
            if (row.user) peers.set(String(row.chat.id), toPeerDto(row.user));
        }
        return peers;
    }

    /** The other participant of ONE private chat (null for groups). */
    async getPeerForChat(
        chatId: ChatId,
        callerId: number,
    ): Promise<PeerDto | null> {
        const chat = await this.chatRepository.findOne({
            where: { id: chatId },
            select: { id: true, type: true },
        });
        if (!chat || chat.type !== TypeChatEnum.PRIVATE) return null;
        const peers = await this.getPeersForChats([chatId], callerId);
        return peers.get(String(chatId)) ?? null;
    }

    /**
     * Unread counts for every chat the user belongs to, in one grouped query.
     * A missing `chat_seen` row counts the whole (non-own, live) history; a
     * soft-deleted message never counts. Duplicate seen rows are tolerated by
     * joining only the newest row per (chat, user).
     */
    async getUnreadCounts(userId: UserId): Promise<Map<string, number>> {
        const rows = await this.memberRepository.query<
            Array<{ chatId: string; count: string }>
        >(
            `SELECT member."chatId" AS "chatId", COUNT(message.id)::int AS "count"
                   FROM chat_members member
                   LEFT JOIN chat_seen seen ON seen.id = (
                       SELECT MAX(s.id)
                         FROM chat_seen s
                        WHERE s."chatId" = member."chatId"
                          AND s."userId" = member."userId"
                   )
                   JOIN messages message
                     ON message."chatId" = member."chatId"
                    AND message."isDeleted" = false
                    AND message."senderId" <> member."userId"
                    AND (
                        seen."messageId" IS NULL
                        OR message.id > seen."messageId"
                    )
                  WHERE member."userId" = $1
                  GROUP BY member."chatId"`,
            [userId],
        );

        const counts = new Map<string, number>();
        for (const row of rows) {
            counts.set(String(row.chatId), Number(row.count) || 0);
        }
        return counts;
    }

    async getInfoChat(id: ChatId) {
        return await this.chatRepository.findOne({ where: { id } });
    }

    /** Display name for typing payloads: profile name, then username, then ''. */
    async getUserDisplayName(userId: UserId): Promise<string> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            relations: { profile: true },
        });
        const name = user?.profile?.name?.trim();
        return name !== undefined && name !== ''
            ? name
            : (user?.profile?.username?.trim() ?? '');
    }

    /** Membership with a role other than `ban` (used to silence banned typers). */
    async isActiveMember(chatId: ChatId, userId: UserId): Promise<boolean> {
        const member = await this.memberRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: userId },
            },
            relations: { role: true },
        });
        return member !== null && member.role?.name !== RoleChatEnum.BAN;
    }

    /** Non-banned member count, in one query (role names, never role ids). */
    async countActiveMembers(chatId: ChatId): Promise<number> {
        const raw = await this.memberRepository
            .createQueryBuilder('member')
            .innerJoin('member.role', 'role')
            .where('member.chat.id = :chatId', { chatId })
            .andWhere('role.name != :banRole', { banRole: RoleChatEnum.BAN })
            .select('COUNT(DISTINCT member.userId)', 'count')
            .getRawOne<{ count: string }>();
        return Number(raw?.count ?? 0);
    }

    /**
     * One shared emit for every membership change; best-effort so realtime
     * failures never break the mutation that caused them.
     */
    async notifyMembersCount(chatId: ChatId): Promise<void> {
        try {
            const membersCount = await this.countActiveMembers(chatId);
            this.groupRealtime.membersCountChanged(chatId, membersCount);
        } catch {
            // The next joinChat re-reads the authoritative count.
        }
    }

    /** Per-caller info extras for the WS `joinChat` ack. */
    async getChatSummary(chatId: ChatId, userId: UserId) {
        const caller = await this.access.getCallerContext(chatId, userId);
        return this.summarizeCaller(caller);
    }

    private async summarizeCaller(caller: ChatCallerContext) {
        const membersCount = await this.countActiveMembers(caller.chat.id);

        return {
            myRole:
                caller.roleName === RoleChatEnum.BAN ? null : caller.roleName,
            myPermissions:
                caller.isManager || !caller.isAdmin ? null : caller.permissions,
            membersCount,
        };
    }

    async updateTitle(chatId: ChatId, callerUserId: UserId, rawTitle: string) {
        const caller = await this.access.getCallerContext(chatId, callerUserId);
        this.access.assertUsableGroup(caller);
        this.access.assertPermissions(caller, [
            PermissionChatEnum.CHANGE_INFO_CHAT,
        ]);

        const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
        if (title.length < 1 || title.length > 64) {
            throw new BadRequestException(
                'title must be between 1 and 64 characters',
            );
        }

        const chat = await this.chatRepository.findOne({
            where: { id: chatId },
        });
        if (!chat) throw new NotFoundException('chat not found');

        await this.chatRepository.update(chat.id, { title });

        this.groupRealtime.groupChanged(chatId, 'title_changed');

        return { message: 'title updated successfully' };
    }

    /** Paginated, searchable member list (banned rows excluded). */
    async getChatMembers(
        chatId: ChatId,
        callerUserId: UserId,
        options: ChatMemberPageOptions,
    ) {
        const chat = await this.chatRepository.findOne({
            where: { id: chatId, type: TypeChatEnum.GRUPE, isBan: false },
        });
        if (!chat) throw new NotFoundException('chat not found');

        // Caller must be a member (the WS/REST guard already checked; this
        // keeps the service usable standalone). Phone numbers only for admins.
        const caller = await this.access.getCallerContext(chatId, callerUserId);
        const includePhone = caller.isManager || caller.isAdmin;

        const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
        const cursor =
            Number(options.cursor) > 0 ? Number(options.cursor) : null;

        const qb = this.memberRepository
            .createQueryBuilder('member')
            .innerJoin('member.role', 'role')
            .innerJoinAndSelect('member.user', 'user')
            .leftJoinAndSelect('user.profile', 'profile')
            .where('member.chat.id = :chatId', { chatId })
            .andWhere('role.name != :banRole', { banRole: RoleChatEnum.BAN })
            .orderBy('member.id', 'ASC')
            .take(limit + 1);

        if (cursor !== null) {
            qb.andWhere('member.id > :cursor', { cursor });
        }

        if (options.search?.trim()) {
            const term = `%${options.search.trim()}%`;
            qb.andWhere(
                '(profile.name ILIKE :term OR profile.username ILIKE :term)',
                {
                    term,
                },
            );
        }

        const rows = await qb.getMany();

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor =
            hasMore && page.length > 0
                ? Number(page[page.length - 1].id)
                : null;

        return {
            data: page.map((member) =>
                this.recordMemberWithPhone(member, includePhone),
            ),
            nextCursor,
            ...(await this.summarizeCaller(caller)),
        };
    }

    /** Kick: removes the member row (ownership + outranking enforced inside). */
    async kickMember(chatId: ChatId, memberId: number, callerUserId: UserId) {
        const target = await this.access.getTargetMemberInChat(
            memberId,
            chatId,
        );
        const caller = await this.access.getCallerContext(chatId, callerUserId);
        this.access.assertUsableGroup(caller);
        this.access.assertRole(caller, RoleChatEnum.ADMIN);
        this.access.assertPermissions(caller, [PermissionChatEnum.BAN_USER]);
        this.access.assertCanTarget(caller, target, 'kick');

        if (target.role?.name === RoleChatEnum.BAN) {
            throw new ConflictException('user is already banned');
        }

        await this.removePermissionsForMember(target.id);
        await this.memberRepository.remove(target);

        this.groupRealtime.groupRemoved(chatId, target.user.id, 'kicked');
        this.groupRealtime.groupChanged(chatId, 'member_kicked');
        await this.notifyMembersCount(chatId);

        return { message: 'user kicked from the group' };
    }

    /** A member leaves; owners cannot leave (no ownership transfer). */
    async leaveChat(chatId: ChatId, callerUserId: UserId) {
        const caller = await this.access.getCallerContext(chatId, callerUserId);
        this.access.assertUsableGroup(caller);

        if (caller.isManager) {
            throw new BadRequestException(
                'the group owner cannot leave the group. Give ownership to another member first (ownership transfer is not supported yet)',
            );
        }
        if (caller.roleName === RoleChatEnum.BAN) {
            throw new ForbiddenException(
                'you have been banned from this group',
            );
        }

        await this.removePermissionsForMember(caller.member.id);
        await this.memberRepository.remove(caller.member);

        this.groupRealtime.groupRemoved(chatId, callerUserId, 'left');
        this.groupRealtime.groupChanged(chatId, 'member_left');
        await this.notifyMembersCount(chatId);

        return { message: 'you have left the group', chatId };
    }

    /**
     * Ban a member: their `chat_members.roleId` becomes the `ban` role (no
     * separate ban table). Same-chat scope, owner protection and outranking all
     * enforced here — the REST guard only pre-checks the caller side.
     */
    async banMember(memberId: number, callerUserId: UserId) {
        const target = await this.access.getTargetMember(memberId);
        const caller = await this.access.getCallerContext(
            target.chat.id,
            callerUserId,
        );
        this.access.assertUsableGroup(caller);
        // Owner-only: `manager` is the group owner; chat `admin` cannot ban.
        this.access.assertOwner(caller, 'ban members');
        this.access.assertCanTarget(caller, target, 'ban');

        if (Number(target.user.id) === Number(callerUserId)) {
            throw new BadRequestException('you cannot ban yourself');
        }

        if (target.role?.name === RoleChatEnum.BAN) {
            throw new ConflictException('user is already banned');
        }

        const banRole = await this.getRoleOrFail(RoleChatEnum.BAN);
        target.role = banRole;
        await this.memberRepository.save(target);
        // A banned admin loses their permission grants.
        await this.removePermissionsForMember(target.id);

        this.groupRealtime.groupRemoved(
            target.chat.id,
            target.user.id,
            'banned',
        );
        this.groupRealtime.groupChanged(target.chat.id, 'member_banned');
        await this.notifyMembersCount(target.chat.id);

        return { message: 'user baned successfully' };
    }

    /** Unban: restores the `user` role (former admins become members). */
    async onBanMember(memberId: number, callerUserId: UserId) {
        const target = await this.access.getTargetMember(memberId);
        const caller = await this.access.getCallerContext(
            target.chat.id,
            callerUserId,
        );
        this.access.assertUsableGroup(caller);
        // Same rule as the banned-users list: owner, or an admin with
        // `ban_user`/`all` (chat `admin` without the grant is rejected).
        this.access.assertRole(caller, RoleChatEnum.ADMIN);
        this.access.assertPermissions(caller, [PermissionChatEnum.BAN_USER]);
        this.access.assertCanTarget(caller, target, 'unban');

        if (target.role?.name !== RoleChatEnum.BAN) {
            throw new BadRequestException('user is not banned');
        }

        const userRole = await this.getRoleOrFail(RoleChatEnum.USER);
        target.role = userRole;
        await this.memberRepository.save(target);

        this.groupRealtime.groupAdded(target.chat.id, target.user.id);
        this.groupRealtime.groupChanged(target.chat.id, 'member_unbanned');
        await this.notifyMembersCount(target.chat.id);

        return { message: 'user on baned successfully' };
    }

    /** Convenience adapter for record-level serialization with caller-gated phone. */
    private recordMemberWithPhone(member: ChatMember, includePhone: boolean) {
        return this.serializeMember(member, member.user, includePhone);
    }

    async getAllBanUser(chatId: ChatId) {
        const chat = await this.chatRepository.findOne({
            where: {
                id: chatId,
                type: Not(TypeChatEnum.PRIVATE),
            },
        });
        if (!chat) throw new NotFoundException('chat not found');

        const banUsers = await this.memberRepository
            .createQueryBuilder('member')
            .innerJoin('member.role', 'role')
            .innerJoinAndSelect('member.user', 'user')
            .leftJoinAndSelect('user.profile', 'profile')
            .where('member.chat.id = :chatId', { chatId })
            .andWhere('role.name = :banRole', { banRole: RoleChatEnum.BAN })
            .orderBy('member.updatedAt', 'DESC')
            .getMany();

        return {
            data: banUsers.map((member) =>
                this.recordMemberWithPhone(member, true),
            ),
        };
    }

    async uploadAvatar(avatar: string, chatId: ChatId, _callerUserId: UserId) {
        const chat = await this.chatRepository.findOne({
            where: {
                type: Not(TypeChatEnum.PRIVATE),
                id: chatId,
            },
        });
        if (!chat) throw new NotFoundException();

        chat.avatars = [...chat.avatars, avatar];
        await this.chatRepository.save(chat);

        this.groupRealtime.groupChanged(chatId, 'avatars_changed');

        return { message: 'avatar updated successfully' };
    }

    async deleteAvatar(
        chatId: ChatId,
        avatarPath: string,
        _callerUserId: UserId,
    ) {
        const chat = await this.chatRepository.findOne({
            where: {
                type: Not(TypeChatEnum.PRIVATE),
                id: chatId,
            },
        });
        if (!chat) throw new NotFoundException();

        if (!chat.avatars.includes(avatarPath)) throw new NotFoundException();

        chat.avatars = chat.avatars.filter((avatar) => avatar !== avatarPath);
        await this.chatRepository.save(chat);
        if (fs.existsSync(avatarPath)) {
            await fs.promises.unlink(avatarPath);
        }
        // Group photos share uploads/avatars, so their thumbnails share the
        // same cleanup (best effort; never fails the request).
        await removeAvatarThumbnails(avatarPath);

        this.groupRealtime.groupChanged(chatId, 'avatars_changed');

        return { message: 'avatar updated successfully' };
    }

    /**
     * Advances the caller's read position for one chat (monotonic).
     *
     * Ids above the chat's newest message are clamped to it; any id at or
     * below the newest must exist in THIS chat (a cross-chat id is rejected).
     * Writes are serialized per (chat, user) with a transaction-scoped
     * advisory lock, so concurrent callers (multiple devices) cannot regress
     * or double-insert the read position. Empty chats are a no-op.
     */
    async markSeen(
        chatId: ChatId,
        userId: UserId,
        givenLastSeenId: number,
    ): Promise<MarkSeenResult> {
        const latest = await this.messageRepository.findOne({
            where: { chat: { id: chatId } },
            order: { id: 'DESC' },
            select: { id: true },
        });
        const latestId = latest ? Number(latest.id) : null;

        if (latestId === null) {
            const existing = await this.getMyLastSeenId(chatId, userId);
            return { lastSeenId: existing ?? 0, changed: false };
        }

        const target = Math.min(givenLastSeenId, latestId);
        const exists = await this.messageRepository.exists({
            where: { id: target, chat: { id: chatId } },
        });
        if (!exists) {
            throw new BadRequestException(
                'seen message not found in this chat',
            );
        }

        return this.seenRepository.manager.transaction(
            async (manager): Promise<MarkSeenResult> => {
                // Serialize writers for this (chat, user) pair. The table has no
                // unique (chatId,userId) constraint, so this replaces an upsert.
                await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
                    chatId,
                    userId,
                ]);
                const repo = manager.getRepository(ChatSeen);
                const rows = await repo.find({
                    where: {
                        chat: { id: chatId },
                        user: { id: userId },
                    },
                    relations: { message: true },
                });

                const current = rows.reduce<number | null>((max, row) => {
                    const id = row.message ? Number(row.message.id) : null;
                    if (id === null) return max;
                    return max === null ? id : Math.max(max, id);
                }, null);

                if (current !== null && current >= target) {
                    return { lastSeenId: current, changed: false };
                }

                const row = rows.reduce<ChatSeen | null>((best, candidate) => {
                    if (best === null) return candidate;
                    const bestId = best.message ? Number(best.message.id) : -1;
                    const candidateId = candidate.message
                        ? Number(candidate.message.id)
                        : -1;
                    return candidateId > bestId ? candidate : best;
                }, null);

                if (row === null) {
                    await repo.save(
                        repo.create({
                            chat: { id: chatId },
                            user: { id: userId },
                            message: { id: target },
                        }),
                    );
                } else {
                    row.message = { id: target } as Message;
                    await repo.save(row);
                }

                return { lastSeenId: target, changed: true };
            },
        );
    }

    /** Read positions shown to the joining caller (`chatInfo`). */
    async getChatSeenState(
        chatId: ChatId,
        userId: UserId,
    ): Promise<ChatSeenState> {
        const myLastSeenId = await this.getMyLastSeenId(chatId, userId);

        const raw = await this.seenRepository
            .createQueryBuilder('seen')
            .innerJoin(
                ChatMember,
                'member',
                'member."userId" = seen."userId" AND member."chatId" = seen."chatId"',
            )
            .innerJoin(RoleChat, 'role', 'role.id = member."roleId"')
            .where('seen."chatId" = :chatId', { chatId })
            .andWhere('seen."userId" != :userId', { userId })
            .andWhere('role.name != :banRole', {
                banRole: RoleChatEnum.BAN,
            })
            .select('MAX(seen."messageId")', 'max')
            .getRawOne<{ max: string | null }>();

        return {
            myLastSeenId,
            othersLastSeenId:
                raw?.max === null || raw?.max === undefined
                    ? null
                    : Number(raw.max),
        };
    }

    private async getMyLastSeenId(
        chatId: ChatId,
        userId: UserId,
    ): Promise<number | null> {
        const raw = await this.seenRepository
            .createQueryBuilder('seen')
            .where('seen."chatId" = :chatId', { chatId })
            .andWhere('seen."userId" = :userId', { userId })
            .select('MAX(seen."messageId")', 'max')
            .getRawOne<{ max: string | null }>();

        return raw?.max === null || raw?.max === undefined
            ? null
            : Number(raw.max);
    }

    async getAllUser(chatId: ChatId) {
        const chat = await this.chatRepository.findOne({
            where: {
                id: chatId,
                isBan: false,
                type: Not(TypeChatEnum.PRIVATE),
            },
        });
        if (!chat) throw new NotFoundException('chat not found');

        const members = await this.memberRepository
            .createQueryBuilder('member')
            .innerJoin('member.role', 'role')
            .innerJoinAndSelect('member.user', 'user')
            .leftJoinAndSelect('user.profile', 'profile')
            .where('member.chat.id = :chatId', { chatId })
            .andWhere('role.name != :banRole', { banRole: RoleChatEnum.BAN })
            .orderBy('member.updatedAt', 'DESC')
            .getMany();

        return {
            data: members.map((member) =>
                this.recordMemberWithPhone(member, true),
            ),
        };
    }

    async banChat(id: ChatId) {
        const chat = await this.chatRepository.findOne({
            where: {
                id,
                isBan: false,
                type: Not(TypeChatEnum.PRIVATE),
            },
        });
        if (!chat) throw new NotFoundException('chat not found');

        await this.chatRepository.update(chat.id, {
            isBan: true,
            avatars: [],
        });

        await this.deleteAllAvatar(chat.avatars);

        return { message: 'chat is ban successfully' };
    }

    async getMemberIds(chatId: ChatId) {
        const members = await this.memberRepository.find({
            where: { chat: { id: chatId } },
            relations: { user: true },
            select: { id: true, user: { id: true } },
        });

        return members.map((m) => m.user.id);
    }

    /**
     * Wire shape for a chat member (numeric ids). The phone number is only
     * exposed to group admins/owners — plain members never receive it.
     */
    serializeMember(
        member: ChatMember,
        user: User & {
            profile?: {
                name: string | null;
                username: string | null;
                avatars: string[];
            } | null;
        },
        includePhone: boolean,
    ) {
        const profile = user.profile;
        return {
            memberId: Number(member.id),
            userId: Number(user.id),
            name: profile?.name ?? 'بدون نام',
            username: profile?.username ?? null,
            avatars: profile?.avatars ?? [],
            isOnline: user.isOnline,
            lastSeen: user.lastSeen,
            status: user.status,
            role: member.role?.name ?? null,
            isBanned: member.role?.name === RoleChatEnum.BAN,
            ...(includePhone ? { phone: user.phone } : {}),
        };
    }

    private async getRoleOrFail(name: RoleChatEnum): Promise<RoleChat> {
        const role = await this.roleChatRepository.findOne({ where: { name } });
        if (!role) throw new NotFoundException(`${name} role not found`);
        return role;
    }

    private async removePermissionsForMember(memberId: number) {
        await this.memberRepository.manager
            .getRepository(PermissionAdmin)
            .delete({ member: { id: memberId } });
    }

    private async deleteAllAvatar(avatars: string[]) {
        try {
            for (const img of avatars) {
                const fileExists = await fs.promises
                    .stat(img)
                    .then(() => true)
                    .catch(() => false);
                if (fileExists) {
                    await fs.promises.unlink(img);
                }
                await removeAvatarThumbnails(img);
            }
        } catch (err) {
            throw new InternalServerErrorException(err);
        }
    }
}
