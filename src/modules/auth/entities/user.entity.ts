import { BaseEntity } from 'src/common/entities/base.entity';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { ChatSeen } from 'src/modules/chats/entities/chats_seen.entity';
import { Column, Entity, Index, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { Role } from './role.entity';
import { UserId } from 'src/common/types/brands.type';
import { UserProfile } from './user_profile.entity';

@Entity('users')
export class User extends BaseEntity {
    declare id: UserId;

    @Index({ unique: true })
    @Column({ unique: true })
    phone: string;

    @Column({ default: false })
    isOnline: boolean;

    @Column({ type: 'timestamp', nullable: true })
    lastSeen: Date;

    @Column({
        type: 'enum',
        enum: UserStatusEnum,
        default: UserStatusEnum.ACTIVE,
    })
    status: UserStatusEnum;

    @Column({ nullable: true })
    refreshToken: string;

    @OneToMany(() => ChatSeen, (chatSeen) => chatSeen.user)
    chatSeen: ChatSeen[];

    @ManyToOne(() => Role, (role) => role.id)
    role: Role;

    @OneToOne(() => UserProfile, (profile) => profile.user)
    profile: UserProfile;
}
