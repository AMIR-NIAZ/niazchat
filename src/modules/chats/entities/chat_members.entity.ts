import { User } from 'src/modules/auth/entities/user.entity';
import { Entity, ManyToOne } from 'typeorm';
import { Chat } from './chat.entity';
import { BaseEntity } from 'src/common/entities/base.entity';
import { RoleChat } from './role_chat.entity';

@Entity('chat_members')
export class ChatMember extends BaseEntity {
    @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
    chat: Chat;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    user: User;

    @ManyToOne(() => RoleChat, (role) => role.members)
    role: RoleChat;
}
