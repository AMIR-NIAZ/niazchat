import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import {
    canManageMemberPermissions,
    ChatPermissionService,
    memberPermissionsConfigOf,
} from './chat-permission.service';
import { GroupRealtimeService } from './group-realtime.service';
import { roleRank } from '../utils/group-members.util';
import {
    hasPermission,
    normalizePermissions,
} from '../utils/group-permissions.util';
import {
    MEMBER_PERMISSION_FORBIDDEN_MESSAGE,
    type MemberPermissionsConfig,
    memberPermissionsChanged,
    mergeMemberPermissions,
    parseMemberPermissionsPatch,
} from '../utils/member-permissions.util';

export interface GroupMemberPermissionsResponse {
    chatId: number;
    /** Complete, validated config (defaults fill any legacy/missing key). */
    permissions: MemberPermissionsConfig;
    /** True only for the owner or an admin with `manage_permissions`. */
    canEdit: boolean;
}

export interface GroupMemberPermissionsUpdateResponse extends GroupMemberPermissionsResponse {
    changed: boolean;
}

/**
 * Group-level MEMBER permission policy (`chats.memberPermissions`).
 *
 * Read: any non-banned member of the group (clients need it to render their
 * own controls). Write: owner, or an admin holding the established
 * `manage_permissions` grant — regular members are always rejected.
 *
 * Updates lock the chat row (`FOR UPDATE`) and re-check the caller's role and
 * grants inside the same transaction, so a concurrent demotion cannot leave a
 * stale capability in place. The merge is field-wise, so two concurrent
 * patches of different switches both land (last write per field wins).
 */
@Injectable()
export class GroupMemberPermissionsService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly permissions: ChatPermissionService,
        private readonly realtime: GroupRealtimeService,
    ) {}

    async getConfig(
        chatId: ChatId,
        callerUserId: UserId,
    ): Promise<GroupMemberPermissionsResponse> {
        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        return {
            chatId: Number(chatId),
            permissions: memberPermissionsConfigOf(caller.chat),
            canEdit: canManageMemberPermissions({
                isOwner: caller.isOwner,
                isAdmin: caller.isAdmin,
                permissions: caller.permissions,
                userId: Number(callerUserId),
            }),
        };
    }

    async updateConfig(
        chatId: ChatId,
        callerUserId: UserId,
        input: unknown,
    ): Promise<GroupMemberPermissionsUpdateResponse> {
        const patch = parseMemberPermissionsPatch(input);
        if (patch === null) {
            throw new BadRequestException(
                'member permissions must be a non-empty object of known boolean keys',
            );
        }

        const caller = await this.permissions.getCallerContext(
            chatId,
            callerUserId,
        );
        this.permissions.assertGroup(caller);
        this.assertEditor(caller);

        const result = await this.dataSource.transaction(async (manager) => {
            // Serialize every config update for this chat. The row lock also
            // keeps the read-merge-write from losing a concurrent field.
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

            await this.assertLockedEditor(manager, chatId, callerUserId);

            const current = normalizeForStorage(chat.memberPermissions);
            const changed = memberPermissionsChanged(current, patch);
            const next = changed
                ? mergeMemberPermissions(current, patch)
                : current;
            if (changed) {
                await manager
                    .getRepository(Chat)
                    .update(chat.id, { memberPermissions: next });
            }

            return {
                chatId: Number(chat.id),
                permissions: next,
                canEdit: true,
                changed,
            };
        });

        if (result.changed) {
            // After commit only: a failed transaction must never announce the
            // policy. Offline clients resync from the GET endpoint.
            this.realtime.groupMemberPermissionsChanged(
                chatId,
                result.permissions,
            );
        }
        return result;
    }

    private assertEditor(caller: {
        isOwner: boolean;
        isAdmin: boolean;
        permissions: readonly string[];
    }): void {
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

    /**
     * Re-checks the caller inside the locked transaction: best role wins
     * (duplicate membership rows exist in real data), the owner passes, an
     * admin must still hold `manage_permissions`, regular members never pass.
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
        const role = (best.role?.name ?? null) as RoleChatEnum | null;

        if (role === RoleChatEnum.MANAGER) return;
        if (role !== RoleChatEnum.ADMIN) {
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

/**
 * Normalizes before storing so a partial legacy object never persists a
 * missing key (the config stored in the column is always complete).
 */
function normalizeForStorage(raw: unknown): MemberPermissionsConfig {
    return memberPermissionsConfigOf({
        memberPermissions: raw as MemberPermissionsConfig,
    });
}
