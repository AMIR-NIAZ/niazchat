import { BaseEntity } from 'src/common/entities/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('reacts')
export class React extends BaseEntity {
    @Column({ unique: true })
    name: string;

    @Column({ unique: true })
    emoji: string;
}
