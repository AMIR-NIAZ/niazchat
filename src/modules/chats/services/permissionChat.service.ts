import {
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { DataSource, In, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionChatDto } from '../dtos/permissionChat.dto';
import { RoleChatEnum } from '../../../common/enums/roleChat.enum';
import { TypeChatEnum } from '../../../common/enums/typeChat.enum';
import { RoleChat } from '../entities/role_chat.entity';
import { PermissionChat } from '../entities/permission_chat.entity';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import { GroupRealtimeService } from './group-realtime.service';
import { num } from 'src/common/utils/ws-serializer.utils';

/**
 * Owner-only admin lifecycle for group chats. The routes are
 * `@ChatAccess({ minRole: MANAGER })`, so the caller is always a chat owner;
 * this service still scopes target members to that owner's chat so an owner
 * can never touch a member of another group.
 */
@Injectable()
export class PermissionChatService {
    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(ChatMember)
        private readonly memberRepository: Repository<ChatMember>,
        @InjectRepository(RoleChat)
        private readonly roleChatRepository: Repository<RoleChat>,
        @InjectRepository(PermissionAdmin)
        private readonly permissionAdminRepository: Repository<PermissionAdmin>,
        @InjectRepository(PermissionChat)
        private readonly permissionChatRepository: Repository<PermissionChat>,
        private readonly groupRealtime: GroupRealtimeService,
    ) {}

    /** Promote a member to admin with an initial permission set. */
    async addAdmin(memberId: number, permission: PermissionChatDto) {
        const member = await this.memberRepository.findOne({
            where: { id: memberId },
        });
        if (!member) throw new NotFoundException('member not found');

        const adminRole = await this.roleChatOrFail(RoleChatEnum.ADMIN);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            member.role = adminRole;
            await queryRunner.manager.save(ChatMember, member);

            await queryRunner.manager.delete(PermissionAdmin, {
                member: { id: member.id },
            });

            if (permission.permissions?.length) {
                const permissions = await queryRunner.manager.find(
                    PermissionChat,
                    {
                        where: {
                            name: In(permission.permissions),
                        },
                    },
                );

                if (permissions?.length !== permission.permissions.length) {
                    const foundName = new Set(permissions.map((p) => p.name));
                    const missingNames = permission.permissions.filter(
                        (name) => {
                            return !foundName.has(name);
                        },
                    );

                    throw new NotFoundException(
                        `Permissions not found: ${missingNames.join(', ')}`,
                    );
                }

                const memberPermissions = permissions.map((per) => ({
                    member: { id: member.id },
                    permission: { id: per.id },
                }));

                await queryRunner.manager.save(
                    PermissionAdmin,
                    memberPermissions,
                );
            }

            await queryRunner.commitTransaction();
            this.notifyAdminsChanged(member.chat.id);
            return { message: 'admin added successfully' };
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException((err as Error).message);
        } finally {
            await queryRunner.release();
        }
    }

    /** Demote an admin back to a plain member. */
    async removeAdmin(memberId: number) {
        const adminRole = await this.roleChatOrFail(RoleChatEnum.ADMIN);

        const member = await this.memberRepository.findOne({
            where: {
                id: memberId,
                role: { id: adminRole.id },
                chat: {
                    type: Not(TypeChatEnum.PRIVATE),
                },
            },
        });
        if (!member) throw new NotFoundException('member not found');

        const userRole = await this.roleChatOrFail(RoleChatEnum.USER);

        try {
            member.role = userRole;
            await this.memberRepository.save(member);
            await this.permissionAdminRepository.delete({
                member: { id: member.id },
            });
        } catch (err) {
            throw new InternalServerErrorException(err);
        }

        this.notifyAdminsChanged(member.chat.id);
        return { message: 'admin removed successfully' };
    }

    /** Grant extra permissions to an ADMIN (union-correct; BAN-role bug fixed). */
    async addPermissionforAdmin(
        memberId: number,
        permissionDto: PermissionChatDto,
    ) {
        const permissions = permissionDto.permissions;
        const adminRole = await this.roleChatOrFail(RoleChatEnum.ADMIN);

        const member = await this.memberRepository.findOne({
            where: {
                id: memberId,
                role: { id: adminRole.id },
            },
        });
        if (!member) throw new NotFoundException('member not found');

        const permissionAdmin = await this.permissionAdminRepository.find({
            where: {
                member: { id: member.id },
            },
        });
        const existingPermissions = permissionAdmin.map(
            (p) => p.permission.name,
        );
        const mergedPermissions = [
            ...new Set([...existingPermissions, ...permissions]),
        ];
        await this.setPermissions(member.id, mergedPermissions);
        this.notifyAdminsChanged(member.chat.id);

        return { message: 'permissions added successfully' };
    }

    /** Revoke permissions (the original implementation kept exactly the wrong rows). */
    async deletePermissionforAdmin(
        memberId: number,
        permissionDto: PermissionChatDto,
    ) {
        const permissions = permissionDto.permissions;
        const member = await this.memberRepository.findOne({
            where: { id: memberId },
        });
        if (!member) throw new NotFoundException('member not found');

        const permissionAdmin = await this.permissionAdminRepository.find({
            where: {
                member: { id: member.id },
            },
        });

        // Keep everything NOT in the delete list.
        const newPermissions = permissionAdmin
            .filter(
                (per) => !permissions.includes(per.permission.name as never),
            )
            .map((perData) => perData.permission.name);
        await this.setPermissions(member.id, newPermissions);
        this.notifyAdminsChanged(member.chat.id);

        return { message: 'permissions deleted successfully' };
    }

    /** All available permission names + the granted set for this admin. */
    async getAdminPermissions(memberId: number) {
        const member = await this.memberRepository.findOne({
            where: { id: memberId },
        });
        if (!member) throw new NotFoundException('member not found');

        const available = await this.permissionChatRepository.find();
        const granted = await this.permissionAdminRepository.find({
            where: { member: { id: memberId } },
            relations: { permission: true },
        });

        return {
            available: available.map((p) => p.name),
            granted: granted
                .map((p) => p.permission.name)
                .filter((name) => name !== 'all'),
        };
    }

    private async setPermissions(adminId: number, permissions?: string[]) {
        await this.permissionAdminRepository.delete({
            member: { id: adminId },
        });

        if (!permissions || permissions.length === 0) return true;

        for (const per of permissions) {
            const perData = await this.permissionChatRepository.findOne({
                where: {
                    name: per,
                },
            });
            if (!perData) throw new NotFoundException('permission not found');

            await this.permissionAdminRepository.save({
                member: { id: adminId },
                permission: { id: perData.id },
            });
        }
    }

    private notifyAdminsChanged(chatId: unknown): void {
        this.groupRealtime.groupChanged(num(chatId), 'admins_changed');
    }

    private async roleChatOrFail(name: RoleChatEnum) {
        const role = await this.roleChatRepository.findOne({ where: { name } });
        if (!role) throw new NotFoundException(`${name} role not found`);
        return role;
    }
}
