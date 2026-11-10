import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { ChatSeen } from 'src/modules/chats/entities/chats_seen.entity';
import { Attachment } from 'src/modules/attachments/entities/attachment.entity';
import { Entity, Column, ManyToOne, OneToMany } from 'typeorm';
import { TypeMessage } from './typeMessage.entity';

@Entity('messages')
export class Message extends BaseEntity {
    /** Text body; null/empty for attachment-only messages. */
    @Column({ type: 'text', nullable: true })
    content: string;

    @ManyToOne(() => TypeMessage)
    type: TypeMessage;

    /**
     * NOT eager: the nested `profile` relation (display name / avatars) is only
     * joined when queries explicitly request `relations: { sender: { profile: true } }`.
     */
    @ManyToOne(() => User)
    sender: User;

    @ManyToOne(() => Chat, (chat) => chat.messages, { onDelete: 'CASCADE' })
    chat: Chat;

    @ManyToOne(() => Message, { nullable: true })
    replyTo: Message;

    @OneToMany(() => ChatSeen, (chatSeen) => chatSeen.message)
    chatSeen: ChatSeen[];

    @OneToMany(() => Attachment, (attachment) => attachment.message)
    attachments: Attachment[];

    @Column({ default: false })
    isEdited: boolean;

    @Column({ default: false })
    isDeleted: boolean;

    /**
     * Forward origin snapshot. Both stay NULL for ordinary messages and are
     * copied unchanged when a forwarded message is forwarded again.
     */
    @Column({ type: 'bigint', nullable: true })
    forwardedFromUserId: number | null;

    @Column({ type: 'varchar', length: 100, nullable: true })
    forwardedFromName: string | null;
}
