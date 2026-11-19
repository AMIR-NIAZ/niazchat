import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChatId, UserId } from 'src/common/types/brands.type';
import { PermissionChatDto } from '../dtos/permissionChat.dto';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import { GroupMembersService } from './group-members.service';
import { normalizePermissions } from '../utils/group-permissions.util';

/**
 * Legacy `/chats/manage/admin/*` surface, kept for old clients. Every method
 * delegates to `GroupMembersService`, so the modern rules (manage_admins /
 * manage_permissions, `promotedById`, grant-subset, owner-only `all`) are the
 * only implementation.
 */
@Injectable()
export class PermissionChatService {
    constructor(
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(PermissionAdmin)
        private readonly permissionAdminRepository: Repository<PermissionAdmin>,
        private readonly groups: GroupMembersService,
    ) {}

    /** Promote with an initial permission set. */
    async addAdmin(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
        dto: PermissionChatDto,
    ) {
        const result = await this.groups.promoteMember(
            chatId,
            memberId,
            callerUserId,
            dto.permissions ?? [],
        );
        return { message: 'admin added successfully', ...result };
    }

    /** Demote an admin back to a plain member. */
    async removeAdmin(chatId: ChatId, memberId: number, callerUserId: UserId) {
        const result = await this.groups.demoteMember(
            chatId,
            memberId,
            callerUserId,
        );
        return { message: 'admin removed successfully', ...result };
    }

    /** Union the given permissions onto the admin's current set. */
    async addPermissionforAdmin(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
        permissionDto: PermissionChatDto,
    ) {
        const current = await this.grantedKeys(chatId, memberId);
        const merged = normalizePermissions([
            ...current,
            ...(permissionDto.permissions ?? []),
        ]);
        const result = await this.groups.updateMemberPermissions(
            chatId,
            memberId,
            callerUserId,
            merged,
        );
        return { message: 'permissions added successfully', ...result };
    }

    /** Remove the given permissions, keeping everything else. */
    async deletePermissionforAdmin(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
        permissionDto: PermissionChatDto,
    ) {
        const remove = new Set(
            normalizePermissions(permissionDto.permissions ?? []).map(String),
        );
        const current = await this.grantedKeys(chatId, memberId);
        const kept = current.filter((key) => !remove.has(String(key)));
        const result = await this.groups.updateMemberPermissions(
            chatId,
            memberId,
            callerUserId,
            kept,
        );
        return { message: 'permissions deleted successfully', ...result };
    }

    /** The admin's normalized grant set (legacy route response). */
    async getAdminPermissions(
        chatId: ChatId,
        memberId: number,
        callerUserId: UserId,
    ) {
        const result = await this.groups.getMemberPermissions(
            chatId,
            memberId,
            callerUserId,
        );
        return {
            available: result.available.map((option) => option.key),
            granted: result.hasAll ? ['all'] : result.granted,
        };
    }

    private async grantedKeys(
        chatId: ChatId,
        memberId: number,
    ): Promise<string[]> {
        const member = await this.memberRepository.findOne({
            where: { id: memberId, chat: { id: chatId } },
            relations: { chat: true, user: true },
        });
        if (!member) throw new NotFoundException('member not found');
        const rows = await this.memberRepository.find({
            where: {
                chat: { id: chatId },
                user: { id: member.user.id },
            },
        });
        const grants = await this.permissionAdminRepository.find({
            where: { member: { id: In(rows.map((row) => Number(row.id))) } },
            relations: { permission: true },
        });
        return normalizePermissions(
            grants.map((grant) => grant.permission.name),
        );
    }
}
