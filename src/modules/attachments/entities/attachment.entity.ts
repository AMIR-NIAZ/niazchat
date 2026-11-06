import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { Message } from 'src/modules/messages/entities/message.entity';
import { AttachmentId } from 'src/common/types/brands.type';
import { AttachmentStatus } from '../enums/attachmentStatus.enum';

@Entity('attachments')
export class Attachment extends BaseEntity {
    declare id: AttachmentId;

    /** Display filename provided by the uploader (sanitized, never used for storage). */
    @Column({ length: 255 })
    originalName: string;

    /** Server-generated filename (uuid + controlled extension). Never derived from client input. */
    @Column({ unique: true, length: 255 })
    storageKey: string;

    /** MIME type verified against the actual file content at upload time. */
    @Column({ length: 100 })
    mimeType: string;

    /** File size in bytes, measured by the server. */
    @Column('bigint')
    size: number;

    @ManyToOne(() => User, { eager: true })
    @JoinColumn()
    uploader: User;

    /** Chat the file was uploaded for. Attachments can only be used in this chat. */
    @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
    @JoinColumn()
    chat: Chat;

    /** Message the attachment is bound to, once the message is created. */
    @ManyToOne(() => Message, { nullable: true, onDelete: 'CASCADE' })
    @JoinColumn()
    message?: Message;

    /** pending (uploaded, not yet sent) -> attached (bound to a message). Single-use. */
    @Column({
        type: 'enum',
        enum: AttachmentStatus,
        default: AttachmentStatus.PENDING,
    })
    status: AttachmentStatus;
}
