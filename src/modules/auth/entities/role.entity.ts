import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from './user.entity';
import { RolePermission } from './role_permission.entity';

@Entity('roles')
export class Role extends BaseEntity {
    @Column({ unique: true })
    name: string;

    @OneToMany(() => User, (user) => user.role)
    users: User[];

    @OneToMany(() => RolePermission, rolePermission => rolePermission.role)
    rolePermissions: RolePermission[];
}
