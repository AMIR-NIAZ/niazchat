import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { Entity, ManyToOne } from 'typeorm';
import { Chat } from './chat.entity';
import { Message } from 'src/modules/messages/entities/message.entity';

@Entity('chat_seen')
export class ChatSeen extends BaseEntity {
    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    user: User;

    @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
    chat: Chat;

    @ManyToOne(() => Message, { nullable: true, onDelete: 'SET NULL' })
    message: Message;
}
