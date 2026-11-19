import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { MemberPermissionOverride } from '../entities/member_permission_override.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import {
    canManageMemberPermissions,
    ChatCallerContext,
    ChatPermissionService,
    memberPermissionsConfigOf,
} from './chat-permission.service';
import { MemberPermissionResolverService } from './member-permission-resolver.service';
import { GroupRealtimeService } from './group-realtime.service';
import { roleRank, toGroupRole } from '../utils/group-members.util';
import {
    hasPermission,
    normalizePermissions,
} from '../utils/group-permissions.util';
import {
    isEmptyMemberPermissionOverrides,
    MEMBER_PERMISSION_FORBIDDEN_MESSAGE,
    type MemberPermissionOverrideMap,
    type MemberPermissionsConfig,
    memberPermissionOverridesChanged,
    mergeMemberPermissionOverrides,
    normalizeMemberPermissionOverrides,
    parseMemberPermissionOverridesPatch,
    resolveMemberPermissions,
    storedMemberPermissionOverrides,
} from '../utils/member-permissions.util';

const OVERRIDE_RATE_LIMIT = 30;
const OVERRIDE_RATE_WINDOW_SECONDS = 60;

export interface MemberPermissionOverridesResponse {
    chatId: number;
    memberId: number;
    userId: number;
    role: 'member';
    /** The group-wide defaults the overrides inherit from. */
    groupPermissions: MemberPermissionsConfig;
    /** Complete tri-state map (`inherit` fills unset keys). */
    overrides: MemberPermissionOverrideMap;
    /** `overrides ?? groupDefaults` for this member. */
    effective: MemberPermissionsConfig;
    /** The caller may edit this member's overrides. */
    canEdit: boolean;
}

export interface MemberPermissionOverridesUpdateResponse extends MemberPermissionOverridesResponse {
    changed: boolean;
}

/**
 * INDIVIDUAL member permission overrides.
 *
 * One optional row per `(chat, user)` (`UQ_chat_member_permission_overrides_
 * chat_user`). Only explicit `allow`/`deny` keys are stored; a row is deleted
 * as soon as every key is `inherit`, so inherit creates no records.
 *
 * Writes are limited to the owner or an admin holding the established
 * `manage_permissions` grant. Overrides only apply to REGULAR members: the
 * owner and admins keep their role/admin-grant powers, so their rows are
 * immutable by this feature. Reads are available to any non-banned member.
 *
 * Every write locks the chat row first, then the caller and target membership
 * rows, and re-checks authorization inside the transaction. That serializes
 * concurrent patches for the same group (field-wise merge, last write per
 * field wins) and prevents a stale editor from racing a demotion.
 */
@Injectable()
export class MemberPermissionOverridesService {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        private readonly dataSource: DataSource,
        private readonly permissions: ChatPermissionService,
        private readonly resolver: MemberPermissionResolverService,
        private readonly realtime: GroupRealtimeService,
        private readonly rateLimit: RateLimitService,
    ) {}

    async getForMember(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
    ): Promise<MemberPermissionOverridesResponse> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        const target = await this.loadTarget(chatId, memberId);
        const groupPermissions = memberPermissionsConfigOf(caller.chat);
        const targetUserId = Number(target.user.id) as UserId;
        const overrides = await this.resolver.getOverrides(
            chatId,
            targetUserId,
        );
        return {
            chatId: Number(chatId),
            memberId: Number(target.id),
            userId: Number(target.user.id),
            role: 'member',
            groupPermissions,
            overrides,
            effective: resolveMemberPermissions(groupPermissions, overrides),
            canEdit: canManageMemberPermissions({
                isOwner: caller.isOwner,
                isAdmin: caller.isAdmin,
                permissions: caller.permissions,
                userId: Number(callerUserId),
            }),
        };
    }

    async updateForMember(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
        input: unknown,
    ): Promise<MemberPermissionOverridesUpdateResponse> {
        const patch = parseMemberPermissionOverridesPatch(input);
        if (patch === null) {
            throw new BadRequestException(
                'member overrides must be a non-empty object of known permission keys with inherit/allow/deny values',
            );
        }

        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        this.assertEditor(caller);

        await this.rateLimit.consume(
            `group:member-overrides:${callerUserId}`,
            OVERRIDE_RATE_LIMIT,
            OVERRIDE_RATE_WINDOW_SECONDS,
            'Too many permission changes, please try again later',
        );

        const result = await this.dataSource.transaction(async (manager) => {
            const chat = await this.lockChat(manager, chatId);
            await this.assertLockedEditor(manager, chatId, callerUserId);
            const target = await this.lockTarget(manager, chatId, memberId);
            return this.applyPatch(manager, chat, target, patch);
        });

        if (result.changed) {
            this.broadcast(chatId, result);
        }
        return result;
    }

    /** Resets every key of one member back to `inherit`. */
    async resetForMember(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
    ): Promise<MemberPermissionOverridesUpdateResponse> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        this.assertEditor(caller);

        await this.rateLimit.consume(
            `group:member-overrides:${callerUserId}`,
            OVERRIDE_RATE_LIMIT,
            OVERRIDE_RATE_WINDOW_SECONDS,
            'Too many permission changes, please try again later',
        );

        const result = await this.dataSource.transaction(async (manager) => {
            const chat = await this.lockChat(manager, chatId);
            await this.assertLockedEditor(manager, chatId, callerUserId);
            const target = await this.lockTarget(manager, chatId, memberId);
            const repository = manager.getRepository(MemberPermissionOverride);
            const current = await repository.findOne({
                where: {
                    chat: { id: chatId },
                    user: { id: Number(target.user.id) as UserId },
                },
                lock: { mode: 'pessimistic_write' },
            });
            const changed = current !== null;
            if (current !== null) {
                await repository.delete({ id: current.id });
            }
            return this.responseFrom(
                chat,
                target,
                normalizeMemberPermissionOverrides({}),
                changed,
            );
        });

        if (result.changed) {
            this.broadcast(chatId, result);
        }
        return result;
    }

    private async applyPatch(
        manager: EntityManager,
        chat: Chat,
        target: ChatMember,
        patch: Partial<MemberPermissionOverrideMap>,
    ): Promise<MemberPermissionOverridesUpdateResponse> {
        const repository = manager.getRepository(MemberPermissionOverride);
        const userId = Number(target.user.id) as UserId;
        const currentRow = await repository.findOne({
            where: { chat: { id: chat.id }, user: { id: userId } },
            lock: { mode: 'pessimistic_write' },
        });
        const current = await this.resolver.getOverrides(
            chat.id,
            userId,
            manager,
        );
        const changed = memberPermissionOverridesChanged(current, patch);
        const next = changed
            ? mergeMemberPermissionOverrides(current, patch)
            : current;

        if (changed) {
            if (isEmptyMemberPermissionOverrides(next)) {
                if (currentRow !== null) {
                    await repository.delete({ id: currentRow.id });
                }
            } else {
                const stored = storedMemberPermissionOverrides(next);
                if (currentRow === null) {
                    await repository.insert({
                        chat: { id: chat.id },
                        user: { id: userId },
                        overrides: stored,
                    });
                } else {
                    await repository.update(currentRow.id, {
                        overrides: stored,
                    });
                }
            }
        }

        return this.responseFrom(chat, target, next, changed);
    }

    private responseFrom(
        chat: Chat,
        target: ChatMember,
        overrides: MemberPermissionOverrideMap,
        changed: boolean,
    ): MemberPermissionOverridesUpdateResponse {
        const groupPermissions = memberPermissionsConfigOf(chat);
        const effective = resolveMemberPermissions(groupPermissions, overrides);
        return {
            chatId: Number(chat.id),
            memberId: Number(target.id),
            userId: Number(target.user.id),
            role: 'member',
            groupPermissions,
            overrides,
            effective,
            canEdit: true,
            changed,
        };
    }

    private broadcast(
        chatId: ChatId,
        result: MemberPermissionOverridesResponse,
    ): void {
        this.realtime.memberPermissionOverridesChanged(
            chatId,
            result.userId,
            result.overrides,
            result.effective,
        );
    }

    private assertEditor(caller: ChatCallerContext): void {
        if (
            !canManageMemberPermissions({
                isOwner: caller.isOwner,
                isAdmin: caller.isAdmin,
                permissions: [...caller.permissions],
            })
        ) {
            throw new ForbiddenException(MEMBER_PERMISSION_FORBIDDEN_MESSAGE);
        }
    }

    private async loadTarget(
        chatId: ChatId,
        memberId: number,
    ): Promise<ChatMember> {
        const target = await this.memberRepository.findOne({
            where: { id: memberId, chat: { id: chatId } },
            relations: { chat: true, role: true, user: true },
        });
        if (target === null) {
            throw new NotFoundException('member not found in this group');
        }
        this.assertRegularMember(target);
        return target;
    }

    private async lockChat(
        manager: EntityManager,
        chatId: ChatId,
    ): Promise<Chat> {
        const chat = await manager
            .getRepository(Chat)
            .createQueryBuilder('chat')
            .where('chat.id = :chatId', { chatId })
            .setLock('pessimistic_write')
            .getOne();
        if (chat === null) {
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
        return chat;
    }

    private async lockTarget(
        manager: EntityManager,
        chatId: ChatId,
        memberId: number,
    ): Promise<ChatMember> {
        const target = await manager
            .getRepository(ChatMember)
            .createQueryBuilder('m')
            .innerJoinAndSelect('m.role', 'role')
            .innerJoinAndSelect('m.user', 'user')
            .where('m.id = :memberId', { memberId })
            .andWhere('m."chatId" = :chatId', { chatId })
            .setLock('pessimistic_write')
            .getOne();
        if (target === null) {
            throw new NotFoundException('member not found in this group');
        }
        // Lock every duplicate membership row of the same user, then require
        // the best role to still be a regular member.
        const rows = await manager
            .getRepository(ChatMember)
            .createQueryBuilder('m')
            .innerJoinAndSelect('m.role', 'role')
            .innerJoinAndSelect('m.user', 'user')
            .where('m."chatId" = :chatId', { chatId })
            .andWhere('m."userId" = :userId', {
                userId: Number(target.user.id),
            })
            .setLock('pessimistic_write')
            .getMany();
        const best = rows.reduce((current, candidate) =>
            roleRank(candidate.role?.name) > roleRank(current.role?.name)
                ? candidate
                : current,
        );
        this.assertRegularMember(best);
        return best;
    }

    private assertRegularMember(target: ChatMember): void {
        const role = (target.role?.name ?? null) as RoleChatEnum | null;
        if (role === RoleChatEnum.BAN) {
            throw new ConflictException(
                'banned members do not have permission overrides',
            );
        }
        if (role !== RoleChatEnum.USER) {
            throw new ConflictException(
                'permission overrides apply to regular members only',
            );
        }
    }

    /**
     * Re-checks the editor under the lock: owner passes, admin must still hold
     * `manage_permissions`, regular members always fail — even for themselves.
     */
    private async assertLockedEditor(
        manager: EntityManager,
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<void> {
        const rows = await manager
            .getRepository(ChatMember)
            .createQueryBuilder('m')
            .innerJoinAndSelect('m.role', 'role')
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
        const role = toGroupRole(best.role?.name);
        if (role === 'owner') return;
        if (role !== 'admin') {
            throw new ForbiddenException(MEMBER_PERMISSION_FORBIDDEN_MESSAGE);
        }
        const grants = await manager.getRepository(PermissionAdmin).find({
            where: { member: { id: In(rows.map((row) => Number(row.id))) } },
            relations: { permission: true },
        });
        if (
            !hasPermission(
                'admin',
                normalizePermissions(
                    grants.map((grant) => grant.permission.name),
                ),
                'manage_permissions',
            )
        ) {
            throw new ForbiddenException(MEMBER_PERMISSION_FORBIDDEN_MESSAGE);
        }
    }
}
