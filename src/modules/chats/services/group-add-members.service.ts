import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { User } from 'src/modules/auth/entities/user.entity';
import { USER_NOT_AVAILABLE_MESSAGE } from 'src/modules/visibility/visibility.service';
import { VisibilityService } from 'src/modules/visibility/visibility.service';
import { ChatMember } from '../entities/chat_members.entity';
import { RoleChat } from '../entities/role_chat.entity';
import type { Message } from 'src/modules/messages/entities/message.entity';
import {
    canAddMembersCapability,
    ChatCallerContext,
    ChatPermissionService,
    PERMISSION_FORBIDDEN_MESSAGE,
} from './chat-permission.service';
import { GroupRealtimeService } from './group-realtime.service';
import {
    MEMBER_PERMISSION_FORBIDDEN,
    type MemberPermissionsConfig,
} from '../utils/member-permissions.util';
import { createServiceMessage } from '../utils/service-message.util';
import {
    AddMemberFailure,
    classifyMembership,
    MAX_ADD_MEMBERS_PER_REQUEST,
    normalizeAddMemberIds,
} from '../utils/group-add-members.util';

export const ADD_MEMBERS_RATE_LIMIT = 30;
export const ADD_MEMBERS_RATE_WINDOW_SECONDS = 60;

/** Second advisory-lock key: serializes membership writes for ONE chat. */
const CHAT_MEMBERSHIP_LOCK_NAMESPACE = 424242;

/**
 * One user the caller may add, as the Add-by-User-ID search shows it. The
 * projection is deliberately narrow: id, display name, username and the
 * CURRENT photo only — never a phone number, status or timestamps.
 */
export interface AddMemberCandidate {
    userId: number;
    name: string;
    username: string | null;
    avatars: string[];
    /** True when the user is already an active (non-banned) member. */
    isMember: boolean;
    /** True when the user's membership row is the `ban` role. */
    isBanned: boolean;
}

/** One membership row created by the batch. */
export interface AddedGroupMember {
    memberId: number;
    userId: number;
    name: string;
    username: string | null;
    avatars: string[];
    role: 'member';
}

export interface AddMembersResponse {
    added: AddedGroupMember[];
    /** Per-user rejections; a partial success answers 200 with both arrays. */
    failed: AddMemberFailure[];
    /** Authoritative non-banned member count after the batch. */
    membersCount: number;
}

/**
 * Adds people to an existing group by user id, in ONE transaction.
 *
 * Authorization (recomputed from the database, never trusted from the app):
 *   - the caller must be a non-banned member of a live GROUP;
 *   - owner/admin need `manage_members`;
 *   - a regular member follows the EFFECTIVE `add_members` state, i.e. the
 *     group default resolved with their individual inherit/allow/deny override.
 *
 * Targets are validated one by one: unknown/inactive users, blocked pairs,
 * already-members and banned users are reported as per-user failures while the
 * rest of the batch still commits (partial success). A per-chat advisory lock
 * plus an in-transaction re-check keeps concurrent requests from creating
 * duplicate membership rows.
 */
@Injectable()
export class GroupAddMembersService {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(RoleChat)
        private readonly roleChatRepository: Repository<RoleChat>,
        private readonly dataSource: DataSource,
        private readonly permissions: ChatPermissionService,
        private readonly realtime: GroupRealtimeService,
        private readonly rateLimit: RateLimitService,
        private readonly visibility: VisibilityService,
    ) {}

    /**
     * Exact-user-id lookup for the "Add by User ID" field. A user who blocked
     * the caller (or is blocked by them) is indistinguishable from an unknown
     * user: the same generic 404, so the endpoint cannot be used to probe.
     */
    async lookupUser(
        chatId: ChatId,
        callerUserId: UserId,
        rawUserId: unknown,
    ): Promise<AddMemberCandidate> {
        const userId = this.parseUserId(rawUserId);
        await this.authorize(chatId, callerUserId);

        if (
            await this.visibility.isBlockedBetween(Number(callerUserId), userId)
        ) {
            throw new NotFoundException(USER_NOT_AVAILABLE_MESSAGE);
        }

        const user = await this.userRepository.findOne({
            where: { id: userId as UserId, status: UserStatusEnum.ACTIVE },
            relations: { profile: true },
        });
        if (user === null) {
            throw new NotFoundException('User not found');
        }

        const rows = await this.memberRepository.find({
            where: { chat: { id: chatId }, user: { id: userId as UserId } },
            relations: { role: true },
        });
        const state = classifyMembership(rows, RoleChatEnum.BAN);

        return {
            userId: Number(user.id),
            name: user.profile?.name ?? 'بدون نام',
            username: user.profile?.username ?? null,
            avatars: this.currentAvatar(user),
            isMember: state === 'member',
            isBanned: state === 'banned',
        };
    }

    /** Adds a bounded batch; every accepted user commits or rolls back together. */
    async addMembers(
        chatId: ChatId,
        callerUserId: UserId,
        rawUserIds: unknown,
    ): Promise<AddMembersResponse> {
        const userIds = normalizeAddMemberIds(rawUserIds);
        if (userIds === null) {
            throw new BadRequestException(
                `userIds must contain between 1 and ${MAX_ADD_MEMBERS_PER_REQUEST} positive user ids`,
            );
        }

        await this.authorize(chatId, callerUserId);
        await this.rateLimit.consume(
            `group:add-members:${callerUserId}`,
            ADD_MEMBERS_RATE_LIMIT,
            ADD_MEMBERS_RATE_WINDOW_SECONDS,
            'Too many member additions, please try again later',
        );

        const blocked = await this.visibility.blockedIdsBetween(
            Number(callerUserId),
            userIds,
        );

        let added: AddedGroupMember[] = [];
        const failed: AddMemberFailure[] = [];
        let serviceMessages: Message[] = [];

        await this.dataSource.transaction(async (manager) => {
            // One writer per chat at a time: a duplicate concurrent request
            // waits here, then sees the rows written by the first one.
            await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
                chatId,
                CHAT_MEMBERSHIP_LOCK_NAMESPACE,
            ]);

            // Permissions are rebuilt INSIDE the lock so a concurrent demote /
            // policy change cannot be bypassed by a stale pre-check.
            const lockedCaller = await this.permissions.getCallerContext(
                chatId,
                callerUserId,
            );
            this.assertCanAdd(lockedCaller);

            const users = await manager.getRepository(User).find({
                where: { id: In(userIds as UserId[]) },
                relations: { profile: true },
            });
            const userById = new Map(
                users
                    .filter((user) => user.status === UserStatusEnum.ACTIVE)
                    .map((user) => [Number(user.id), user] as const),
            );

            const existing = await manager
                .getRepository(ChatMember)
                .createQueryBuilder('member')
                .innerJoinAndSelect('member.role', 'role')
                .where('member."chatId" = :chatId', { chatId })
                .andWhere('member."userId" IN (:...userIds)', { userIds })
                .getMany();
            const rowsByUser = new Map<number, ChatMember[]>();
            for (const row of existing) {
                const id = Number(row.user.id);
                const rows = rowsByUser.get(id) ?? [];
                rows.push(row);
                rowsByUser.set(id, rows);
            }

            const userRole = await manager
                .getRepository(RoleChat)
                .findOne({ where: { name: RoleChatEnum.USER } });
            if (userRole === null) {
                throw new InternalServerErrorException('user role not found');
            }

            const accepted: User[] = [];
            for (const userId of userIds) {
                const user = userById.get(userId);
                if (user === undefined) {
                    failed.push({
                        userId,
                        code: 'not_found',
                        message: 'This user does not exist',
                    });
                    continue;
                }
                if (blocked.has(userId)) {
                    failed.push({
                        userId,
                        code: 'blocked',
                        message: 'This user cannot be added to the group',
                    });
                    continue;
                }
                const state = classifyMembership(
                    rowsByUser.get(userId) ?? [],
                    RoleChatEnum.BAN,
                );
                if (state === 'banned') {
                    failed.push({
                        userId,
                        code: 'banned',
                        message:
                            'This user is banned from this group and cannot be added',
                    });
                    continue;
                }
                if (state === 'member') {
                    failed.push({
                        userId,
                        code: 'already_member',
                        message: 'This user is already a member',
                    });
                    continue;
                }
                accepted.push(user);
            }

            if (accepted.length === 0) {
                added = [];
                return;
            }

            await manager.getRepository(ChatMember).insert(
                accepted.map((user) => ({
                    chat: { id: chatId },
                    user: { id: user.id },
                    role: { id: userRole.id },
                })),
            );

            const insertedRows = await manager.query<
                Array<{ id: string | number; userId: string | number }>
            >(
                `SELECT id, "userId" FROM "chat_members"
                  WHERE "chatId" = $1 AND "userId" = ANY($2::bigint[])
                  ORDER BY id ASC`,
                [chatId, accepted.map((user) => Number(user.id))],
            );
            const memberIdByUser = new Map<number, number>();
            for (const row of insertedRows) {
                const userId = Number(row.userId);
                if (!memberIdByUser.has(userId)) {
                    memberIdByUser.set(userId, Number(row.id));
                }
            }

            added = accepted.map((user) => ({
                memberId: memberIdByUser.get(Number(user.id)) ?? 0,
                userId: Number(user.id),
                name: user.profile?.name ?? 'بدون نام',
                username: user.profile?.username ?? null,
                avatars: this.currentAvatar(user),
                role: 'member' as const,
            }));

            serviceMessages = [];
            for (const user of accepted) {
                serviceMessages.push(
                    await createServiceMessage(manager, {
                        chatId,
                        action: 'member_added',
                        actorId: Number(callerUserId),
                        targetId: Number(user.id),
                    }),
                );
            }
        });

        let membersCount = await this.countActiveMembers(chatId);
        if (added.length > 0) {
            const addedIds = added.map((member) => member.userId);
            this.realtime.groupChanged(chatId, 'member_joined');
            for (const userId of addedIds) {
                // Reaches every socket of the new member (personal room): the
                // app refreshes its chat list and can open the group right away.
                this.realtime.groupAdded(chatId, userId);
            }
            const memberIds = await this.activeMemberIds(chatId);
            for (const message of serviceMessages) {
                this.realtime.broadcastServiceMessage(
                    message,
                    memberIds,
                    addedIds,
                );
            }
            membersCount = await this.countActiveMembers(chatId);
            this.realtime.membersCountChanged(chatId, membersCount);
        }

        return { added, failed, membersCount };
    }

    /** Caller context + group type + the effective add-members rule. */
    private async authorize(
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<ChatCallerContext> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        this.assertCanAdd(caller);
        return caller;
    }

    private assertCanAdd(caller: ChatCallerContext): void {
        const permissions: MemberPermissionsConfig =
            caller.effectiveMemberPermissions;
        if (canAddMembersCapability(caller, permissions)) return;
        throw new ForbiddenException(
            caller.isOwner || caller.isAdmin
                ? PERMISSION_FORBIDDEN_MESSAGE
                : MEMBER_PERMISSION_FORBIDDEN.add_members,
        );
    }

    private parseUserId(raw: unknown): number {
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) {
            throw new BadRequestException('userId must be a positive integer');
        }
        return value;
    }

    /** Current photo only, same wire convention as the members list. */
    private currentAvatar(user: User): string[] {
        const avatars = user.profile?.avatars ?? [];
        return avatars.length > 0 ? [avatars[0]] : [];
    }

    /** Every member id of the chat (banned included, callers decide). */
    private async activeMemberIds(chatId: ChatId): Promise<number[]> {
        const rows = await this.memberRepository.query<
            Array<{ userId: string | number }>
        >(
            `SELECT DISTINCT member."userId" AS "userId"
               FROM chat_members member
               JOIN role_chat role ON role.id = member."roleId"
              WHERE member."chatId" = $1 AND role.name <> $2`,
            [chatId, RoleChatEnum.BAN],
        );
        return rows.map((row) => Number(row.userId));
    }

    /** Non-banned member count, identical to `GET /chats/:chatId/group`. */
    private async countActiveMembers(chatId: ChatId): Promise<number> {
        const rows = await this.memberRepository.query<
            Array<{ count: string | number }>
        >(
            `SELECT COUNT(DISTINCT member."userId")::int AS count
               FROM chat_members member
               JOIN role_chat role ON role.id = member."roleId"
              WHERE member."chatId" = $1 AND role.name <> $2`,
            [chatId, RoleChatEnum.BAN],
        );
        return Number(rows[0]?.count ?? 0);
    }
}

/** Kept for callers that only need the batch cap. */
export { MAX_ADD_MEMBERS_PER_REQUEST };
