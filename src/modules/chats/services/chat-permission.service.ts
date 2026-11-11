import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import type { GroupCallerRules, GroupRole } from '../utils/group-members.util';
import { roleRank, toGroupRole } from '../utils/group-members.util';

/**
 * Caller authorization context for the group panel.
 *
 * Duplicate `(chatId, userId)` rows exist in real data, so the caller's role is
 * the highest-ranking row and permissions are the union over every row. Banned
 * callers are rejected here; the panel service still re-checks the group type
 * and `isBan` for every operation.
 */
export interface ChatCallerContext {
    chat: Chat;
    /** Canonical (highest-ranking, then oldest) caller row. */
    member: ChatMember;
    /** Every `chat_members.id` belonging to the caller in this chat. */
    memberIds: number[];
    roleName: RoleChatEnum;
    role: GroupRole;
    permissions: PermissionChatEnum[];
    isOwner: boolean;
    isAdmin: boolean;
}

/**
 * Group-info editing capability (pure, shared by reads and writes).
 *
 * The owner always may; an admin needs `change_info_chat` or the `all`
 * bypass. Members, banned users and outsiders never may.
 */
/**
 * Invite-link management capability: the owner and every admin may create,
 * list and revoke links (no extra permission grant); members, banned users and
 * outsiders may not.
 */
export function canManageInviteLinks(caller: GroupCallerRules): boolean {
    return caller.isOwner || caller.isAdmin;
}

export function canEditInfo(caller: GroupCallerRules): boolean {
    if (caller.isOwner) return true;
    if (!caller.isAdmin) return false;
    return (
        caller.permissions.includes(PermissionChatEnum.CHANGE_INFO_CHAT) ||
        caller.permissions.includes(PermissionChatEnum.ALL)
    );
}

@Injectable()
export class ChatPermissionService {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(PermissionAdmin)
        private readonly permissionAdminRepository: Repository<PermissionAdmin>,
    ) {}

    async getCallerContext(
        chatId: ChatId,
        userId: UserId,
    ): Promise<ChatCallerContext> {
        const rows = await this.memberRepository.find({
            where: { chat: { id: chatId }, user: { id: userId } },
            relations: { chat: true, role: true },
            order: { id: 'ASC' },
        });
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
        const grants = await this.permissionAdminRepository.find({
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

    /** 400 for private chats ("This action is only available in groups"). */
    assertGroup(caller: ChatCallerContext): void {
        if (caller.chat.type !== TypeChatEnum.GRUPE) {
            throw new BadRequestException(
                'This action is only available in groups',
            );
        }
        if (caller.chat.isBan) {
            throw new ForbiddenException('this chat has been banned');
        }
    }
}
