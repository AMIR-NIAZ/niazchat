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

    /** Pixel width for images and videos (display orientation, rotation applied). */
    @Column({ type: 'int', nullable: true })
    width?: number | null;

    /** Pixel height for images and videos (display orientation, rotation applied). */
    @Column({ type: 'int', nullable: true })
    height?: number | null;

    /** Duration in seconds (one decimal) for videos and voice messages. */
    @Column({ type: 'numeric', precision: 10, scale: 1, nullable: true })
    duration?: string | number | null;

    /**
     * Voice-message marker (set only by the `voice=1` upload path). NULL means
     * "not voice"; the wire `kind` is derived from this flag plus the MIME.
     */
    @Column({ type: 'boolean', nullable: true })
    voice?: boolean | null;

    /**
     * 64 bucketed RMS amplitudes (integers 0..100) for a voice message. NULL
     * when waveform generation failed; the app then draws flat bars.
     */
    @Column('smallint', { array: true, nullable: true })
    waveform?: number[] | null;

    /**
     * Relative storage path of the generated WebP poster (videos only). Never
     * leaves the server: the wire exposes a derived `hasPoster` boolean.
     */
    @Column({ type: 'varchar', length: 255, nullable: true })
    posterPath?: string | null;

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
