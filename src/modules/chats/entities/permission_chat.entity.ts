import { BaseEntity } from 'src/common/entities/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('permission_chats')
export class PermissionChat extends BaseEntity {
    @Column({ unique: true })
    name: string;
}
