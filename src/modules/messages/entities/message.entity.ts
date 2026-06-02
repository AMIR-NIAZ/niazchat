import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { ChatSeen } from 'src/modules/chats/entities/chats_seen.entity';
import { Entity, Column, ManyToOne, OneToMany } from 'typeorm';
import { TypeMessage } from './typeMessage.entity';

@Entity('messages')
export class Message extends BaseEntity {
    @Column({ type: 'text', nullable: true })
    content: string;

    @ManyToOne(() => TypeMessage)
    type: TypeMessage;

    @ManyToOne(() => User, { eager: true })
    sender: User;

    @ManyToOne(() => Chat, (chat) => chat.messages, { onDelete: 'CASCADE' })
    chat: Chat;

    @ManyToOne(() => Message, { nullable: true })
    replyTo: Message;

    @OneToMany(() => ChatSeen, (chatSeen) => chatSeen.message)
    chatSeen: ChatSeen[];

    @Column({ default: false })
    isEdited: boolean;

    @Column({ default: false })
    isDeleted: boolean;
}
