import { Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { PermissionChat } from './permission_chat.entity';
import { ChatMember } from './chat_members.entity';

@Entity('permission_admin')
export class PermissionAdmin extends BaseEntity {
    @ManyToOne(() => PermissionChat, { onDelete: 'CASCADE' })
    permission: PermissionChat;

    @ManyToOne(() => ChatMember, { onDelete: 'CASCADE' })
    member: ChatMember;
}
