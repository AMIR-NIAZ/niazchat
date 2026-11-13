import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import { PermissionChat } from '../entities/permission_chat.entity';
import { RoleChat } from '../entities/role_chat.entity';
import {
    assertCanManageBans,
    canEditInfo,
    canManageBans,
    canManageInviteLinks,
    ChatCallerContext,
    ChatPermissionService,
} from './chat-permission.service';
import { GroupRealtimeService } from './group-realtime.service';
import {
    ADMIN_PERMISSION_OPTIONS,
    canDemote,
    canPromote,
    canRemove,
    decodeMemberCursor,
    EDITABLE_ADMIN_PERMISSIONS,
    EditableAdminPermission,
    encodeMemberCursor,
    escapeLikeTerm,
    GroupMemberActions,
    GroupRole,
    memberActions,
    parseEditablePermissions,
    roleRank,
    samePermissionSet,
    toGroupRole,
} from '../utils/group-members.util';

/** Every newly promoted admin receives exactly these permissions. */
export const DEFAULT_ADMIN_PERMISSIONS: readonly PermissionChatEnum[] = [
    PermissionChatEnum.BAN_USER,
    PermissionChatEnum.DELETE_MESSAGE,
    PermissionChatEnum.CHANGE_INFO_CHAT,
];

export const GROUP_ACTION_RATE_LIMIT = 30;
export const GROUP_ACTION_RATE_WINDOW_SECONDS = 60;
export const GROUP_MEMBERS_DEFAULT_LIMIT = 30;
export const GROUP_MEMBERS_MAX_LIMIT = 100;

const RANK_SQL = `CASE r.name WHEN 'manager' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END`;

export interface GroupInfo {
    id: number;
    title: string;
    description: string | null;
    avatars: string[];
    capabilities: {
        canEditInfo: boolean;
        canManageInviteLinks: boolean;
        canManageBans: boolean;
    };
    createdAt: Date;
    membersCount: number;
    myRole: GroupRole;
    owner: { userId: number; name: string; username: string } | null;
}

export interface GroupMemberItem {
    memberId: number;
    userId: number;
    name: string;
    username: string;
    avatars: string[];
    isOnline: boolean;
    lastSeen: string | null;
    role: GroupRole;
    actions: GroupMemberActions;
}

export interface GroupMemberPage {
    items: GroupMemberItem[];
    nextCursor: string | null;
}

export interface GroupBannedItem {
    memberId: number;
    userId: number;
    name: string;
    username: string;
    /** Current photo only, same wire shape as the members list. */
    avatars: string[];
    /** ISO timestamp of the ban (last `chat_members.updatedAt`), if known. */
    bannedAt: string | null;
}

export interface GroupBannedPage {
    items: GroupBannedItem[];
    nextCursor: string | null;
}

interface BannedQueryRow {
    memberId: string | number;
    userId: string | number;
    name: string | null;
    username: string | null;
    avatars: string[] | null;
    bannedAt: Date | string | null;
}

export interface MemberActionResponse {
    memberId: number;
    role: GroupRole | null;
    changed: boolean;
}

export interface MemberPermissionsResponse {
    memberId: number;
    userId: number;
    role: 'admin';
    available: Array<{ key: EditableAdminPermission; label: string }>;
    granted: EditableAdminPermission[];
    hasAll: boolean;
}

export interface MemberPermissionsUpdateResponse {
    memberId: number;
    granted: EditableAdminPermission[];
    changed: boolean;
}

type RoleOperation = 'promote' | 'demote' | 'remove';

interface MemberQueryRow {
    memberId: string | number;
    userId: string | number;
    role: GroupRole;
    rank: string | number;
    name: string | null;
    username: string | null;
    avatars: string[] | null;
    isOnline: boolean;
    lastSeen: Date | string | null;
}

/**
 * Group panel server state: info, paginated members and role/removal actions.
 *
 * Every action runs in ONE transaction that locks the caller and target rows,
 * re-checks group type / ban state / same chat / outranking and matches the
 * target's current role. Role names bound to the seeded `role_chat` table are
 * the only role identity, never numeric ids. Realtime events are sent after
 * commit and never delay or fail the HTTP response.
 */
@Injectable()
export class GroupMembersService {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(RoleChat)
        private readonly roleChatRepository: Repository<RoleChat>,
        private readonly dataSource: DataSource,
        private readonly permissions: ChatPermissionService,
        private readonly realtime: GroupRealtimeService,
        private readonly rateLimit: RateLimitService,
        @InjectRepository(PermissionAdmin)
        private readonly permissionAdminRepository: Repository<PermissionAdmin>,
    ) {}

    async getGroupInfo(
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<GroupInfo> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);

        const [countRows, ownerRows] = await Promise.all([
            this.memberRepository.query<Array<{ count: string | number }>>(
                `SELECT COUNT(DISTINCT m."userId")::int AS count
                   FROM chat_members m
                   JOIN role_chat r ON r.id = m."roleId"
                  WHERE m."chatId" = $1 AND r.name <> 'ban'`,
                [chatId],
            ),
            this.memberRepository.query<
                Array<{
                    userId: string | number;
                    name: string | null;
                    username: string | null;
                }>
            >(
                `SELECT m."userId" AS "userId",
                        p.name AS name,
                        p.username AS username
                   FROM chat_members m
                   JOIN role_chat r ON r.id = m."roleId"
              LEFT JOIN user_profiles p ON p."userId" = m."userId"
                  WHERE m."chatId" = $1 AND r.name = 'manager'
                  ORDER BY m.id ASC
                  LIMIT 1`,
                [chatId],
            ),
        ]);

        const owner = ownerRows[0];
        return {
            id: Number(caller.chat.id),
            title: caller.chat.title ?? '',
            description: caller.chat.description ?? null,
            avatars: [...(caller.chat.avatars ?? [])],
            capabilities: {
                canEditInfo: canEditInfo(caller),
                canManageInviteLinks: canManageInviteLinks(caller),
                canManageBans: canManageBans(caller),
            },
            createdAt: caller.chat.createdAt,
            membersCount: Number(countRows[0]?.count ?? 0),
            myRole: caller.role,
            owner:
                owner === undefined
                    ? null
                    : {
                          userId: Number(owner.userId),
                          name: owner.name ?? '',
                          username: owner.username ?? '',
                      },
        };
    }

    async getMembers(
        chatId: ChatId,
        callerUserId: UserId,
        options: { search?: string; cursor?: string; limit?: number | string },
    ): Promise<GroupMemberPage> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);

        const limit = this.normalizeLimit(options.limit);
        const cursor =
            typeof options.cursor === 'string' && options.cursor !== ''
                ? decodeMemberCursor(options.cursor)
                : null;
        if (
            options.cursor !== undefined &&
            options.cursor !== '' &&
            cursor === null
        ) {
            throw new BadRequestException('invalid members cursor');
        }

        const search = (options.search ?? '').trim();
        const params: unknown[] = [chatId, limit + 1];
        let searchSql = '';
        if (search.length > 0) {
            params.push(`%${escapeLikeTerm(search)}%`);
            searchSql = `AND (COALESCE(p.name, '') ILIKE $3 ESCAPE '\\' OR COALESCE(p.username, '') ILIKE $3 ESCAPE '\\')`;
        }

        let cursorSql = '';
        if (cursor !== null) {
            const cursorParam = params.length + 1;
            params.push(cursor.rank, cursor.memberId);
            cursorSql = `AND ("rank" < $${cursorParam} OR ("rank" = $${cursorParam} AND "memberId" > $${cursorParam + 1}))`;
        }

        const rows = await this.memberRepository.query<MemberQueryRow[]>(
            `WITH ranked AS (
                SELECT m.id AS "memberId",
                       m."userId" AS "userId",
                       CASE r.name WHEN 'manager' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END AS "role",
                       ${RANK_SQL} AS "rank",
                       p.name AS "name",
                       p.username AS "username",
                       p.avatars AS "avatars",
                       u."isOnline" AS "isOnline",
                       u."lastSeen" AS "lastSeen",
                       ROW_NUMBER() OVER (
                           PARTITION BY m."userId"
                           ORDER BY ${RANK_SQL} DESC, m.id ASC
                       ) AS "rn"
                  FROM chat_members m
                  JOIN role_chat r ON r.id = m."roleId"
                  JOIN users u ON u.id = m."userId"
             LEFT JOIN user_profiles p ON p."userId" = m."userId"
                 WHERE m."chatId" = $1
                   AND r.name <> 'ban'
                   ${searchSql}
             )
             SELECT * FROM ranked
              WHERE "rn" = 1
              ${cursorSql}
              ORDER BY "rank" DESC, "memberId" ASC
              LIMIT $2`,
            params,
        );

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const callerRules = {
            isOwner: caller.isOwner,
            isAdmin: caller.isAdmin,
            permissions: caller.permissions,
        };
        const items: GroupMemberItem[] = page.map((row) => {
            const role = row.role;
            const avatars = Array.isArray(row.avatars) ? row.avatars : [];
            return {
                memberId: Number(row.memberId),
                userId: Number(row.userId),
                name: row.name ?? '',
                username: row.username ?? '',
                // Current photo only.
                avatars: avatars.slice(0, 1),
                isOnline: row.isOnline === true,
                lastSeen:
                    row.lastSeen === null || row.lastSeen === undefined
                        ? null
                        : new Date(row.lastSeen).toISOString(),
                role,
                actions: memberActions(callerRules, role),
            };
        });

        const last = items[items.length - 1];
        return {
            items,
            nextCursor:
                hasMore && last !== undefined
                    ? encodeMemberCursor(roleRank(last.role), last.memberId)
                    : null,
        };
    }

    /**
     * Paginated list of the group's banned users (`role_chat.name = 'ban'`).
     *
     * Owner, or an admin holding `ban_user`/`all`. Banned rows are deduplicated
     * by user (oldest membership row wins, like the members list) and ordered by
     * membership row id DESC, so a new ban always lands on the first page.
     * The cursor is the last `memberId` of the page as a string.
     */
    async getBannedMembers(
        chatId: ChatId,
        callerUserId: UserId,
        options: { cursor?: string; limit?: number | string },
    ): Promise<GroupBannedPage> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        assertCanManageBans(caller);

        const limit = this.normalizeLimit(options.limit);
        let cursor: number | null = null;
        if (typeof options.cursor === 'string' && options.cursor !== '') {
            const parsed = Number(options.cursor);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new BadRequestException('invalid banned cursor');
            }
            cursor = parsed;
        }

        const rows = await this.memberRepository.query<BannedQueryRow[]>(
            `WITH banned AS (
                SELECT m.id AS "memberId",
                       m."userId" AS "userId",
                       p.name AS "name",
                       p.username AS "username",
                       p.avatars AS "avatars",
                       m."updatedAt" AS "bannedAt",
                       ROW_NUMBER() OVER (
                           PARTITION BY m."userId" ORDER BY m.id ASC
                       ) AS "rn"
                  FROM chat_members m
                  JOIN role_chat r ON r.id = m."roleId"
             LEFT JOIN user_profiles p ON p."userId" = m."userId"
                 WHERE m."chatId" = $1 AND r.name = 'ban'
             )
             SELECT * FROM banned
              WHERE "rn" = 1
                AND ($3::bigint IS NULL OR "memberId" < $3)
              ORDER BY "memberId" DESC
              LIMIT $2`,
            [chatId, limit + 1, cursor],
        );

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const items: GroupBannedItem[] = page.map((row) => ({
            memberId: Number(row.memberId),
            userId: Number(row.userId),
            name: row.name ?? '',
            username: row.username ?? '',
            avatars: Array.isArray(row.avatars) ? row.avatars.slice(0, 1) : [],
            bannedAt:
                row.bannedAt === null || row.bannedAt === undefined
                    ? null
                    : new Date(row.bannedAt).toISOString(),
        }));

        const last = items[items.length - 1];
        return {
            items,
            nextCursor:
                hasMore && last !== undefined ? String(last.memberId) : null,
        };
    }

    async getMemberPermissions(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
    ): Promise<MemberPermissionsResponse> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        if (!caller.isOwner) {
            throw new ForbiddenException(
                "You don't have permission to do this",
            );
        }

        const target = await this.memberRepository.findOne({
            where: { id: memberId, chat: { id: chatId } },
            relations: { chat: true, role: true, user: true },
        });
        if (!target) {
            throw new NotFoundException('member not found in this group');
        }
        const targetUserId = Number(target.user.id);
        const rows = await this.rowsOfUser(chatId, targetUserId);
        const best = this.bestRow(rows);
        if (best === null || toGroupRole(best.role?.name) !== 'admin') {
            throw new ConflictException('Only admins have permissions');
        }

        const grants = await this.permissionAdminRepository.find({
            where: { member: { id: In(rows.map((row) => Number(row.id))) } },
            relations: { permission: true },
        });
        const names = grants.map((grant) => grant.permission.name);
        const hasAll = names.includes(PermissionChatEnum.ALL);
        const granted = hasAll
            ? [...EDITABLE_ADMIN_PERMISSIONS]
            : EDITABLE_ADMIN_PERMISSIONS.filter((permission) =>
                  names.includes(permission),
              );

        return {
            memberId: Number(best.id),
            userId: targetUserId,
            role: 'admin',
            available: ADMIN_PERMISSION_OPTIONS.map((option) => ({
                ...option,
            })),
            granted,
            hasAll,
        };
    }

    /**
     * Replaces an admin's permission set with EXACTLY the body's set.
     *
     * One transaction locks the caller and every row of the target user, checks
     * the owner/role state again, then deletes all grants and inserts the new
     * set on the canonical (highest-ranked, lowest-id) row. Reads union grants
     * across duplicate rows, so keeping one canonical row is sufficient.
     */
    async updateMemberPermissions(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
        rawPermissions: unknown,
    ): Promise<MemberPermissionsUpdateResponse> {
        const desired = parseEditablePermissions(rawPermissions);
        if (desired === null) {
            throw new BadRequestException('invalid permissions');
        }

        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        if (!caller.isOwner) {
            throw new ForbiddenException(
                "You don't have permission to do this",
            );
        }

        const target = await this.memberRepository.findOne({
            where: { id: memberId, chat: { id: chatId } },
            relations: { chat: true, role: true, user: true },
        });
        if (!target) {
            throw new NotFoundException('member not found in this group');
        }
        const targetUserId = Number(target.user.id);
        if (toGroupRole(target.role?.name) !== 'admin') {
            throw new ConflictException('Only admins have permissions');
        }
        if (Number(callerUserId) === targetUserId) {
            throw new ConflictException('Only admins have permissions');
        }

        await this.rateLimit.consume(
            `group:permissions:${callerUserId}`,
            GROUP_ACTION_RATE_LIMIT,
            GROUP_ACTION_RATE_WINDOW_SECONDS,
            'Too many permission changes, please try again later',
        );

        const result = await this.dataSource.transaction(async (manager) => {
            const callerCtx = await this.loadLockedCaller(
                manager,
                chatId,
                callerUserId,
            );
            if (callerCtx.chat.type !== caller.chat.type) {
                throw new ConflictException('chat changed, retry');
            }
            if (callerCtx.chat.isBan) {
                throw new ForbiddenException('this chat has been banned');
            }
            if (!callerCtx.isOwner) {
                throw new ForbiddenException(
                    "You don't have permission to do this",
                );
            }

            const targetRows = await manager
                .getRepository(ChatMember)
                .createQueryBuilder('m')
                .innerJoinAndSelect('m.role', 'role')
                .where('m."chatId" = :chatId', { chatId })
                .andWhere('m."userId" = :userId', { userId: targetUserId })
                .setLock('pessimistic_write')
                .getMany();
            if (targetRows.length === 0) {
                throw new ConflictException(
                    'member is no longer in this group',
                );
            }
            const bestTarget = this.bestRow(targetRows);
            if (
                bestTarget === null ||
                toGroupRole(bestTarget.role?.name) !== 'admin'
            ) {
                throw new ConflictException('Only admins have permissions');
            }

            const targetIds = targetRows.map((row) => Number(row.id));
            const grantRepository = manager.getRepository(PermissionAdmin);
            const grants = await grantRepository.find({
                where: { member: { id: In(targetIds) } },
                relations: { permission: true },
            });
            const names = grants.map((grant) => grant.permission.name);
            const hasAll = names.includes(PermissionChatEnum.ALL);
            const current = EDITABLE_ADMIN_PERMISSIONS.filter((permission) =>
                names.includes(permission),
            );
            const changed = hasAll || !samePermissionSet(current, desired);

            if (!changed) {
                return {
                    memberId: Number(bestTarget.id),
                    granted: desired,
                    changed: false,
                };
            }

            await grantRepository.delete({
                member: { id: In(targetIds) },
            });
            if (desired.length > 0) {
                const permissionRows = await manager
                    .getRepository(PermissionChat)
                    .find({ where: { name: In(desired) } });
                if (permissionRows.length !== desired.length) {
                    throw new InternalServerErrorException(
                        'permissions are not seeded',
                    );
                }
                await grantRepository.insert(
                    permissionRows.map((permission) => ({
                        member: { id: Number(bestTarget.id) },
                        permission: { id: permission.id },
                    })),
                );
            }

            return {
                memberId: Number(bestTarget.id),
                granted: desired,
                changed: true,
            };
        });

        if (result.changed) {
            this.realtime.memberPermissionsChanged(chatId, targetUserId);
        }
        return result;
    }

    promoteMember(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
    ): Promise<MemberActionResponse> {
        return this.changeRole(chatId, memberId, callerUserId, 'promote');
    }

    demoteMember(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
    ): Promise<MemberActionResponse> {
        return this.changeRole(chatId, memberId, callerUserId, 'demote');
    }

    removeMember(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
    ): Promise<MemberActionResponse> {
        return this.changeRole(chatId, memberId, callerUserId, 'remove');
    }

    private async changeRole(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
        operation: RoleOperation,
    ): Promise<MemberActionResponse> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);

        const target = await this.memberRepository.findOne({
            where: { id: memberId, chat: { id: chatId } },
            relations: { chat: true, role: true, user: true },
        });
        if (!target) {
            throw new NotFoundException('member not found in this group');
        }
        const targetUserId = Number(target.user.id);
        const expectedRole = toGroupRole(target.role?.name);

        await this.rateLimit.consume(
            `group:member-action:${callerUserId}`,
            GROUP_ACTION_RATE_LIMIT,
            GROUP_ACTION_RATE_WINDOW_SECONDS,
            'Too many group actions, please try again later',
        );

        const result = await this.dataSource.transaction(async (manager) => {
            const callerCtx = await this.loadLockedCaller(
                manager,
                chatId,
                callerUserId,
            );
            if (callerCtx.chat.type !== caller.chat.type) {
                throw new ConflictException('chat changed, retry');
            }
            if (callerCtx.chat.isBan) {
                throw new ForbiddenException('this chat has been banned');
            }

            const targetRows = await manager
                .getRepository(ChatMember)
                .createQueryBuilder('m')
                .innerJoinAndSelect('m.role', 'role')
                .where('m."chatId" = :chatId', { chatId })
                .andWhere('m."userId" = :userId', { userId: targetUserId })
                .setLock('pessimistic_write')
                .getMany();
            if (targetRows.length === 0) {
                throw new ConflictException(
                    'member is no longer in this group',
                );
            }

            const targetIds = targetRows.map((row) => Number(row.id));
            const bestTarget = targetRows.reduce((current, candidate) =>
                roleRank(candidate.role?.name) > roleRank(current.role?.name)
                    ? candidate
                    : current,
            );
            const lockedRole = toGroupRole(bestTarget.role?.name);

            if (Number(callerUserId) === targetUserId) {
                throw new ForbiddenException(
                    'you cannot perform this action on yourself',
                );
            }
            if (lockedRole === null) {
                throw new ConflictException('member role changed, retry');
            }
            if (lockedRole === 'owner') {
                throw new ForbiddenException(
                    'you cannot perform this action on the group owner',
                );
            }

            const rules = {
                isOwner: callerCtx.isOwner,
                isAdmin: callerCtx.isAdmin,
                permissions: callerCtx.permissions,
            };

            if (operation === 'promote') {
                if (!callerCtx.isOwner) {
                    throw new ForbiddenException(
                        "You don't have permission to do this",
                    );
                }
                if (lockedRole === 'admin') {
                    return {
                        memberId: Number(bestTarget.id),
                        role: 'admin' as GroupRole,
                        changed: false,
                    };
                }
                if (!canPromote(rules, lockedRole)) {
                    throw new ForbiddenException(
                        "You don't have permission to do this",
                    );
                }
                const adminRole = await this.roleOrFail(
                    manager,
                    RoleChatEnum.ADMIN,
                );
                await this.setRoleForRows(manager, targetIds, adminRole.id);
                await this.grantDefaultAdminPermissions(
                    manager,
                    Number(bestTarget.id),
                    targetIds,
                );
                return {
                    memberId: Number(bestTarget.id),
                    role: 'admin' as GroupRole,
                    changed: true,
                };
            }

            if (operation === 'demote') {
                if (!callerCtx.isOwner) {
                    throw new ForbiddenException(
                        "You don't have permission to do this",
                    );
                }
                if (lockedRole === 'member') {
                    return {
                        memberId: Number(bestTarget.id),
                        role: 'member' as GroupRole,
                        changed: false,
                    };
                }
                if (!canDemote(rules, lockedRole)) {
                    throw new ForbiddenException(
                        "You don't have permission to do this",
                    );
                }
                const userRole = await this.roleOrFail(
                    manager,
                    RoleChatEnum.USER,
                );
                await this.setRoleForRows(manager, targetIds, userRole.id);
                await manager
                    .getRepository(PermissionAdmin)
                    .delete({ member: { id: In(targetIds) } });
                return {
                    memberId: Number(bestTarget.id),
                    role: 'member' as GroupRole,
                    changed: true,
                };
            }

            // remove
            if (!canRemove(rules, lockedRole)) {
                throw new ForbiddenException(
                    "You don't have permission to do this",
                );
            }
            // A role changed between the pre-check and the lock: do not guess.
            if (expectedRole !== null && expectedRole !== lockedRole) {
                throw new ConflictException('member role changed, retry');
            }
            await manager
                .getRepository(PermissionAdmin)
                .delete({ member: { id: In(targetIds) } });
            await manager
                .getRepository(ChatMember)
                .delete({ id: In(targetIds) });
            return {
                memberId: Number(bestTarget.id),
                role: null,
                changed: true,
            };
        });

        if (operation === 'remove') {
            void this.realtime
                .memberRemoved(chatId, targetUserId)
                .catch(() => undefined);
            void this.notifyMembersCount(chatId);
        } else if (result.changed) {
            this.realtime.memberRoleChanged(chatId, targetUserId);
        }

        return result;
    }

    /**
     * Locks and rebuilds the caller context inside the action transaction,
     * including the permission union over duplicate membership rows.
     */
    private async loadLockedCaller(
        manager: EntityManager,
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<ChatCallerContext> {
        const rows = await manager
            .getRepository(ChatMember)
            .createQueryBuilder('m')
            .innerJoinAndSelect('m.role', 'role')
            .innerJoinAndSelect('m.chat', 'chat')
            .where('m."chatId" = :chatId', { chatId })
            .andWhere('m."userId" = :userId', { userId: callerUserId })
            .setLock('pessimistic_write')
            .getMany();

        if (rows.length === 0) {
            throw new ForbiddenException('you are not a member of this group');
        }
        const best = rows.reduce((current, candidate) =>
            roleRank(candidate.role?.name) > roleRank(current.role?.name)
                ? candidate
                : current,
        );
        const roleName = (best.role?.name ?? '') as RoleChatEnum;
        const role = toGroupRole(roleName);
        if (role === null) {
            throw new ForbiddenException(
                'you have been banned from this group',
            );
        }
        const memberIds = rows.map((row) => Number(row.id));
        const grants = await manager.getRepository(PermissionAdmin).find({
            where: { member: { id: In(memberIds) } },
            relations: { permission: true },
        });
        const permissions = [
            ...new Set(
                grants.map(
                    (grant) => grant.permission.name as PermissionChatEnum,
                ),
            ),
        ];

        return {
            chat: best.chat,
            member: best,
            memberIds,
            roleName,
            role,
            permissions,
            isOwner: role === 'owner',
            isAdmin: role === 'admin',
        };
    }

    /** One UPDATE for every duplicate row of the target user. */
    private async setRoleForRows(
        manager: EntityManager,
        memberIds: number[],
        roleId: number,
    ): Promise<void> {
        await manager.query(
            `UPDATE "chat_members" SET "roleId" = $1 WHERE id = ANY($2::bigint[])`,
            [roleId, memberIds],
        );
    }

    private async rowsOfUser(
        chatId: ChatId,
        userId: number,
    ): Promise<ChatMember[]> {
        return this.memberRepository.find({
            where: { chat: { id: chatId }, user: { id: userId as UserId } },
            relations: { role: true },
            order: { id: 'ASC' },
        });
    }

    private bestRow(rows: ChatMember[]): ChatMember | null {
        if (rows.length === 0) return null;
        return rows.reduce((current, candidate) =>
            roleRank(candidate.role?.name) > roleRank(current.role?.name)
                ? candidate
                : current,
        );
    }

    private async grantDefaultAdminPermissions(
        manager: EntityManager,
        canonicalMemberId: number,
        targetMemberIds: number[],
    ): Promise<void> {
        const grantRepository = manager.getRepository(PermissionAdmin);
        await grantRepository.delete({ member: { id: In(targetMemberIds) } });

        const permissions = await manager
            .getRepository(PermissionChat)
            .find({ where: { name: In([...DEFAULT_ADMIN_PERMISSIONS]) } });
        if (permissions.length === 0) return;
        await grantRepository.insert(
            permissions.map((permission) => ({
                member: { id: canonicalMemberId },
                permission: { id: permission.id },
            })),
        );
    }

    private async roleOrFail(
        manager: EntityManager,
        name: RoleChatEnum,
    ): Promise<RoleChat> {
        const role = await manager
            .getRepository(RoleChat)
            .findOne({ where: { name } });
        if (!role) throw new NotFoundException(`${name} role not found`);
        return role;
    }

    private async notifyMembersCount(chatId: ChatId): Promise<void> {
        try {
            const rows = await this.memberRepository.query<
                Array<{ count: string | number }>
            >(
                `SELECT COUNT(DISTINCT m."userId")::int AS count
                   FROM chat_members m
                   JOIN role_chat r ON r.id = m."roleId"
                  WHERE m."chatId" = $1 AND r.name <> 'ban'`,
                [chatId],
            );
            this.realtime.membersCountChanged(
                chatId,
                Number(rows[0]?.count ?? 0),
            );
        } catch {
            // The next joinChat reloads the authoritative count.
        }
    }

    private normalizeLimit(raw: number | string | undefined): number {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return GROUP_MEMBERS_DEFAULT_LIMIT;
        }
        return Math.min(
            Math.max(Math.trunc(parsed), 1),
            GROUP_MEMBERS_MAX_LIMIT,
        );
    }
}
