import { BaseEntity } from 'src/common/entities/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('permissions')
export class Permission extends BaseEntity {
    @Column({ unique: true })
    name: string;
}
