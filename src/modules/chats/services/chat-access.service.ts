import {
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import { PermissionChat } from '../entities/permission_chat.entity';

/**
 * Ranked power of a chat role. `ban` beats nothing, `user` is a plain member,
 * `admin` manages, `manager` is the owner (full power). Role rows are matched
 * by NAME from the seeded `role_chat` table — never by numeric id.
 */
export const CHAT_ROLE_RANK: Record<RoleChatEnum, number> = {
    [RoleChatEnum.BAN]: 0,
    [RoleChatEnum.USER]: 1,
    [RoleChatEnum.ADMIN]: 2,
    [RoleChatEnum.MANAGER]: 3,
};

/** Everything the caller needs to be authorized against a target member. */
export interface ChatCallerContext {
    chat: Chat;
    member: ChatMember;
    roleName: RoleChatEnum;
    /** Granted permission names; empty (never `['all']`) for manager/user roles. */
    permissions: PermissionChatEnum[];
    isManager: boolean;
    isAdmin: boolean;
}

/**
 * Single source of truth for group-chat authorization, shared by the REST
 * guard, the WS guards and the manage services:
 *   - owner (`manager`) can do anything to non-owner members,
 *   - admin acts only on plain members (and banned rows, for the ban list),
 *   - nobody ever targets the owner, and targets must be in the caller's chat.
 */
@Injectable()
export class ChatAccessService {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(PermissionAdmin)
        private readonly permissionAdminRepository: Repository<PermissionAdmin>,
        @InjectRepository(PermissionChat)
        private readonly permissionChatRepository: Repository<PermissionChat>,
    ) {}

    /** Loads the caller's membership in `chatId` with role + granted permissions. */
    async getCallerContext(
        chatId: ChatId,
        userId: UserId,
    ): Promise<ChatCallerContext> {
        const member = await this.memberRepository.findOne({
            where: {
                chat: { id: chatId },
                user: { id: userId },
            },
            relations: { chat: true, role: true },
        });
        if (!member) {
            throw new ForbiddenException('you are not a member of this group');
        }

        const permissions = (await this.permissionAdminRepository.find({
            where: { member: { id: member.id } },
            relations: { permission: true },
        })).map(
            (row) => row.permission.name as PermissionChatEnum,
        );

        const roleName = (member.role?.name ?? '') as RoleChatEnum;
        return {
            chat: member.chat,
            member,
            roleName,
            permissions,
            isManager: roleName === RoleChatEnum.MANAGER,
            isAdmin: roleName === RoleChatEnum.ADMIN,
        };
    }

    /**
     * The chat must be a live group for any management action. Also used as a
     * read guard for the members list.
     */
    assertUsableGroup(caller: ChatCallerContext): void {
        if (caller.chat.type !== TypeChatEnum.GRUPE) {
            throw new ForbiddenException(
                'this action is only available for group chats',
            );
        }
        if (caller.chat.isBan) {
            throw new ForbiddenException('this chat has been banned');
        }
    }

    /** `minRole` must be outranked by the caller; banned callers fail always. */
    assertRole(caller: ChatCallerContext, minRole: RoleChatEnum): void {
        if (caller.roleName === RoleChatEnum.BAN) {
            throw new ForbiddenException(
                'you have been banned from this group',
            );
        }
        if (
            CHAT_ROLE_RANK[caller.roleName] <
            CHAT_ROLE_RANK[minRole]
        ) {
            throw new ForbiddenException('insufficient role for this action');
        }
    }

    /** Admin callers need every `required` permission (`all` satisfies any). */
    assertPermissions(
        caller: ChatCallerContext,
        required: PermissionChatEnum[],
    ): void {
        if (!caller.isAdmin) return; // manager passes implicitly
        if (required.length === 0) return; // admin-only route, no permission gate
        if (caller.permissions.includes(PermissionChatEnum.ALL)) return;
        const missing = required.filter(
            (permission) => !caller.permissions.includes(permission),
        );
        if (missing.length > 0) {
            throw new ForbiddenException(
                `missing permission(s): ${missing.join(', ')}`,
            );
        }
    }

    /** Target must live in the caller's chat and strictly below the caller. */
    assertCanTarget(
        caller: ChatCallerContext,
        target: ChatMember,
        action: string,
    ): void {
        if (target.chat.id !== caller.chat.id) {
            throw new ForbiddenException(
                'the target member does not belong to this chat',
            );
        }
        const targetRole = (target.role?.name ?? '') as RoleChatEnum;
        if (targetRole === RoleChatEnum.MANAGER) {
            throw new ForbiddenException(`you cannot ${action} the group owner`);
        }
        if (caller.isAdmin && CHAT_ROLE_RANK[targetRole] >= CHAT_ROLE_RANK[RoleChatEnum.ADMIN]) {
            throw new ForbiddenException(
                `admins cannot ${action} other admins`,
            );
        }
    }

    /**
     * Loads a target member row with its role + chat (for same-chat and
     * outranking checks) or 404s.
     */
    async getTargetMember(memberId: number): Promise<ChatMember> {
        const member = await this.memberRepository.findOne({
            where: { id: memberId },
            relations: { chat: true, role: true },
        });
        if (!member) {
            throw new NotFoundException('member not found');
        }
        return member;
    }

    /** Loads a target member scoped to one chat (404 on cross-chat ids). */
    async getTargetMemberInChat(
        memberId: number,
        chatId: ChatId,
    ): Promise<ChatMember> {
        const member = await this.memberRepository.findOne({
            where: { id: memberId, chat: { id: chatId } },
            relations: { chat: true, role: true },
        });
        if (!member) {
            throw new NotFoundException('member not found in this chat');
        }
        return member;
    }

    /** Owner-only actions reject everyone else with a clear message. */
    assertOwner(caller: ChatCallerContext, action: string): void {
        if (!caller.isManager) {
            throw new ForbiddenException(
                `only the group owner can ${action}`,
            );
        }
    }
}
