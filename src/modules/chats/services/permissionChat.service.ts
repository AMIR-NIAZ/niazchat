import {
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { DataSource, In, Not, Repository } from 'typeorm';
import { TypeChatEnum } from '../../../common/enums/typeChat.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatMember } from '../entities/chat_members.entity';
import { PermissionChatDto } from '../dtos/permissionChat.dto';
import { RoleChatEnum } from '../../../common/enums/roleChat.enum';
import { RoleChat } from '../entities/role_chat.entity';
import { PermissionChatEnum } from '../../../common/enums/permissionChat.enum';
import { PermissionAdmin } from '../entities/permission_admin.entity';
import { PermissionChat } from '../entities/permission_chat.entity';

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
    ) {}

    async addAdmin(memberId: number, permission: PermissionChatDto) {
        const member = await this.memberRepository.findOne({
            where: {
                id: memberId,
                chat: {
                    type: Not(TypeChatEnum.PRIVATE),
                },
            },
        });
        if (!member) throw new NotFoundException('member not found');

        const adminRole = await this.roleChatRepository.findOneOrFail({
            where: {
                name: RoleChatEnum.ADMIN,
            },
        });

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

                await queryRunner.commitTransaction();
                return { message: 'admin added successfully' };
            }
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException((err as Error).message);
        } finally {
            await queryRunner.release();
        }
    }

    async removeAdmin(memberId: number) {
        const adminRole = await this.roleChatRepository.findOneOrFail({
            where: {
                name: RoleChatEnum.ADMIN,
            },
        });

        const member = await this.memberRepository.findOne({
            where: {
                id: memberId,
                chat: {
                    type: Not(TypeChatEnum.PRIVATE),
                },
                role: { id: adminRole.id },
            },
        });
        if (!member) throw new NotFoundException('member not found');

        const userRole = await this.roleChatRepository.findOneOrFail({
            where: {
                name: RoleChatEnum.USER,
            },
        });

        try {
            member.role = userRole;
            await this.memberRepository.save(member);
            await this.permissionAdminRepository.delete({
                member: { id: member.id },
            });
        } catch (err) {
            throw new InternalServerErrorException(err);
        }

        return { message: 'admin removed successfully' };
    }

    async addPermissionforAdmin(
        memberId: number,
        permissionDto: PermissionChatDto,
    ) {
        const permissions = permissionDto.permissions;
        const adminRole = await this.roleChatRepository.findOne({
            where: { name: RoleChatEnum.BAN },
        });
        if (!adminRole) throw new NotFoundException('admin role not found');

        const member = await this.memberRepository.findOne({
            where: {
                id: memberId,
                chat: {
                    type: Not(TypeChatEnum.PRIVATE),
                },
                role: { id: adminRole.id },
            },
        });
        if (!member) throw new NotFoundException('member not found');

        const permissinAdmin = await this.permissionAdminRepository.find({
            where: {
                member: { id: member.id },
            },
        });
        const existingPermissions = permissinAdmin.map(
            (p) => p.permission.name,
        );
        const mergedPermissions = <PermissionChatEnum[]>[
            ...new Set([...existingPermissions, ...permissions]),
        ];
        await this.setPermissions(member.id, mergedPermissions);
        return { message: 'permissions added successfully' };
    }

    async deletePermissionforAdmin(
        memberId: number,
        permissionDto: PermissionChatDto,
    ) {
        const permissions = permissionDto.permissions;
        const member = await this.memberRepository.findOne({
            where: {
                id: memberId,
                chat: {
                    type: Not(TypeChatEnum.PRIVATE),
                },
            },
        });
        if (!member) throw new NotFoundException('member not found');

        const permissinAdmin = await this.permissionAdminRepository.find({
            where: {
                member: { id: member.id },
            },
        });

        const newPermissions = permissinAdmin
            .filter((per) =>
                permissions.includes(per.permission.name as PermissionChatEnum),
            )
            .map((perData) => perData.permission.name as PermissionChatEnum);
        await this.setPermissions(member.id, newPermissions);

        return { message: 'permissions deleted successfully' };
    }

    async getAdminPermissions(memberId: number) {
        const permissions = await this.permissionAdminRepository.find({
            where: { member: { id: memberId } },
            relations: ['permission'],
        });

        return {
            permissions: permissions.map((p) => p.permission.name),
        };
    }

    private async setPermissions(
        adminId: number,
        permissions?: PermissionChatEnum[],
    ) {
        await this.permissionAdminRepository.delete({
            member: { id: adminId },
        });

        if (!permissions) return true;

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

    async updateAdminPermissions(
        memberId: number,
        permission: PermissionChatDto,
    ) {
        const adminRole = await this.roleChatRepository.findOneOrFail({
            where: { name: RoleChatEnum.ADMIN },
        });
        const admin = await this.memberRepository.findOne({
            where: {
                id: memberId,
                role: { id: adminRole.id },
            },
        });
        if (!admin) throw new NotFoundException('admin not found');

        const newPermissions = await this.permissionChatRepository.find({
            where: { name: In(permission.permissions) },
        });

        const foundNames = new Set(newPermissions.map((p) => p.name));
        const missingNames = permission.permissions.filter(
            (name) => !foundNames.has(name),
        );

        if (missingNames.length > 0) {
            throw new NotFoundException(
                `Permissions not found: ${missingNames.join(', ')}`,
            );
        }

        const memberPermissions = newPermissions.map((permission) => ({
            member: { id: admin.id },
            permission: { id: permission.id },
        }));

        try {
            await this.permissionAdminRepository.delete({
                member: { id: admin.id },
            });
            await this.permissionAdminRepository.save(memberPermissions);
        } catch (err) {
            throw new InternalServerErrorException((err as Error).message);
        }

        return { message: 'Permissions updated successfully' };
    }
}
