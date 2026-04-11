import { BaseEntity } from 'src/common/entities/base.entity';
import { UserStatusEnum } from 'src/common/enums/UserStatus.enum';
import { ChatSeen } from 'src/modules/chats/entities/chats_seen.entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { Role } from './role.entity';

@Entity('users')
export class User extends BaseEntity {
    @Column({ nullable: true, default: 'بدون نام' })
    name: string;

    @Index({ unique: true })
    @Column({ unique: true })
    phone: string;

    @Column({ nullable: true })
    biografy: string;

    @Column({ length: 30, unique: true, nullable: true })
    username: string;

    @Column('text', { array: true, default: '{}' })
    avatars: string[];

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
}
