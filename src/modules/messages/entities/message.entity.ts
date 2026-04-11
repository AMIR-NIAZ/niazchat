import { BaseEntity } from 'src/common/entities/base.entity';
import { MessageTypeEnum } from 'src/common/enums/MessageType.enum';
import { User } from 'src/modules/auth/entities/user.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { ChatSeen } from 'src/modules/chats/entities/chats_seen.entity';
import { Entity, Column, ManyToOne, OneToMany } from 'typeorm';

@Entity('messages')
export class Message extends BaseEntity {
    @Column({ type: 'text', nullable: true })
    content: string;

    @Column({
        type: 'enum',
        enum: MessageTypeEnum,
        default: MessageTypeEnum.TEXT,
    })
    type: MessageTypeEnum;

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
