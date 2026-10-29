import { BaseEntity } from 'src/common/entities/base.entity';
import { ProfileId, UserId } from 'src/common/types/brands.type';
import {
    Column,
    Entity,
    Index,
    JoinColumn,
    OneToOne,
    RelationId,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_profiles')
export class UserProfile extends BaseEntity {
    declare id: ProfileId;

    @Column({ type: 'varchar', nullable: true })
    name: string | null;

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 30, unique: true, nullable: true })
    username: string | null;

    @Column({ type: 'varchar', nullable: true })
    biografy: string | null;

    @Column('text', { array: true, default: '{}' })
    avatars: string[];

    @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @RelationId((profile: UserProfile) => profile.user)
    userId: UserId;
}
