import { BaseEntity } from 'src/common/entities/base.entity';
import { Entity, ManyToOne } from 'typeorm';
import { User } from './user.entity';
import { Permission } from './permission.entity';

@Entity('user_permissions')
export class UserPermission extends BaseEntity {
    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    user: User;

    @ManyToOne(() => Permission, { onDelete: 'CASCADE' })
    permission: Permission;
}
