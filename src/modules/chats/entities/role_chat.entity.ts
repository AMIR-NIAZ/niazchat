import { BaseEntity } from '../../../common/entities/base.entity';
import { Column, Entity, OneToMany } from 'typeorm';
import { ChatMember } from './chat_members.entity';

@Entity('role_chat')
export class RoleChat extends BaseEntity {
    @Column({ unique: true })
    name: string;

    @OneToMany(() => ChatMember, (member) => member.role)
    members: ChatMember[];
}
