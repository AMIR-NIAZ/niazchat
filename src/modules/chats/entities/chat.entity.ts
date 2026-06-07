import { BaseEntity } from 'src/common/entities/base.entity';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { Message } from 'src/modules/messages/entities/message.entity';
import { Column, Entity, OneToMany, OneToOne } from 'typeorm';
import { ChatSeen } from './chats_seen.entity';
import { ChatMember } from './chat_members.entity';
import { ChatId } from 'src/common/types/brands.type';

@Entity('chats')
export class Chat extends BaseEntity {
    declare id: ChatId;

    @Column({ nullable: true })
    title?: string;

    @Column('text', { array: true, default: '{}' })
    avatars: string[];

    @OneToMany(() => Message, (message) => message.chat)
    messages: Message[];

    @OneToMany(() => ChatSeen, (chatSeen) => chatSeen.chat)
    chatSeen: ChatSeen[];

    @OneToOne(() => Message, { nullable: true })
    lastMessage: Message;

    @OneToMany(() => ChatMember, (chatMember) => chatMember.chat)
    members: ChatMember[];

    @Column({
        type: 'enum',
        enum: TypeChatEnum,
    })
    type: TypeChatEnum;

    @Column({ default: false })
    isBan: boolean;
}
