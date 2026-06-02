import {
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { UserPermission } from '../entities/user_permissions.entity';
import { PermissionsDto } from '../dtos/permission.dto';
import { RoleEnum } from 'src/common/enums/role.enum';

@Injectable()
export class PermissionService {
    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Role)
        private readonly roleRepository: Repository<Role>,
        @InjectRepository(Permission)
        private readonly permissionRepository: Repository<Permission>,
        @InjectRepository(UserPermission)
        private readonly userPermissionRepository: Repository<UserPermission>,
    ) {}

    async addAdmin(id: number, permissionsDto: PermissionsDto) {
        const ownerRole = await this.roleRepository.findOneOrFail({
            where: { name: RoleEnum.OWNER },
        });
        const adminRole = await this.roleRepository.findOneOrFail({
            where: { name: RoleEnum.ADMIN },
        });

        const user = await this.userRepository.findOne({
            where: {
                id,
                role: {
                    id: Not(In([ownerRole.id, adminRole.id])),
                },
            },
            relations: ['role'],
        });
        if (!user) {
            throw new NotFoundException(
                'User not found or user is already admin/owner',
            );
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            user.role = adminRole;
            await queryRunner.manager.save(user);

            await queryRunner.manager.delete(UserPermission, {
                user: { id: user.id },
            });

            if (permissionsDto.permissions?.length) {
                const permissions = await queryRunner.manager.find(Permission, {
                    where: { name: In(permissionsDto.permissions) },
                });

                if (permissions.length !== permissionsDto.permissions.length) {
                    const foundNames = new Set(permissions.map((p) => p.name));
                    const missingNames = permissionsDto.permissions.filter(
                        (name) => !foundNames.has(name),
                    );
                    throw new NotFoundException(
                        `Permissions not found: ${missingNames.join(', ')}`,
                    );
                }

                const userPermissions = permissions.map((permission) => ({
                    user: { id: user.id },
                    permission: { id: permission.id },
                }));

                await queryRunner.manager.save(UserPermission, userPermissions);
            }

            await queryRunner.commitTransaction();
            return {
                message: 'Admin added successfully',
            };
        } catch (err) {
            await queryRunner.rollbackTransaction();
            if (err instanceof NotFoundException) throw err;
            throw new InternalServerErrorException(
                'Failed to add admin: ' + (err as Error).message,
            );
        } finally {
            await queryRunner.release();
        }
    }

    async deleteAdmin(id: number) {
        const adminRole = await this.roleRepository.findOneOrFail({
            where: { name: RoleEnum.ADMIN },
        });

        const admin = await this.userRepository.findOne({
            where: {
                id,
                role: {
                    id: adminRole.id,
                },
            },
            relations: ['role'],
        });
        if (!admin) throw new NotFoundException('admin not found');

        const userRole = await this.roleRepository.findOneOrFail({
            where: { name: RoleEnum.USER },
        });

        try {
            admin.role = userRole;
            await this.userRepository.save(admin);

            await this.userPermissionRepository.delete({
                user: {
                    id: admin.id,
                },
            });
        } catch (err) {
            throw new InternalServerErrorException(err);
        }

        return { message: 'admin is change role' };
    }

    async getAllAdmins() {
        const adminRole = await this.roleRepository.findOneOrFail({
            where: { name: RoleEnum.ADMIN },
        });
        const ownerRole = await this.roleRepository.findOneOrFail({
            where: { name: RoleEnum.OWNER },
        });

        const admins = await this.userRepository.find({
            where: {
                role: In([adminRole.id, ownerRole.id]),
            },
        });

        return { data: admins };
    }

    async updateAdminPermissions(adminId: number, permission: PermissionsDto) {
        const adminRole = await this.roleRepository.findOneOrFail({
            where: { name: RoleEnum.ADMIN },
        });
        const admin = await this.userRepository.findOne({
            where: {
                id: adminId,
                role: { id: adminRole.id },
            },
        });
        if (!admin) throw new NotFoundException('admin not found');

        const newPermissions = await this.permissionRepository.find({
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

        const userPermissions = newPermissions.map((permission) => ({
            user: { id: admin.id },
            permission: { id: permission.id },
        }));

        try {
            await this.userPermissionRepository.delete({
                user: { id: admin.id },
            });
            await this.userPermissionRepository.save(userPermissions);
        } catch (err) {
            throw new InternalServerErrorException((err as Error).message);
        }

        return { message: 'Permissions updated successfully' };
    }

    async getAdminPermissions(id: number) {
        const permissionsUser = await this.userPermissionRepository.find({
            where: {
                user: { id },
            },
            relations: ['permission'],
        });

        const permissions = permissionsUser.map((per) => {
            return per.permission;
        });

        return { data: permissions };
    }
}
