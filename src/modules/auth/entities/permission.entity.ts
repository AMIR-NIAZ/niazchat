import { BaseEntity } from 'src/common/entities/base.entity';
import { Column, Entity, OneToMany } from 'typeorm';
import { RolePermission } from './role_permission.entity';

@Entity('permissions')
export class Permission extends BaseEntity {
    @Column({ unique: true })
    name: string;

    @OneToMany(() => RolePermission, up => up.permission)
    roles: RolePermission[];
}
