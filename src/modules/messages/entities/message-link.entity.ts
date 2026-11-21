import { BaseEntity } from 'src/common/entities/base.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { Message } from './message.entity';

/**
 * One URL extracted from a message body at write time.
 *
 * The Links tab reads this table instead of scanning `messages.content`:
 * `(chatId, createdAt, id)` is the pagination index and the cursor uses the
 * same tuple, so pages stay stable while new messages arrive.
 *
 * `createdAt` mirrors the MESSAGE's creation time (not the row insert time),
 * so a backfilled link still groups under the month its message was sent.
 * `(messageId, url)` is unique, which makes extraction and the backfill
 * idempotent: re-running them never duplicates a row.
 */
@Entity('message_links')
@Index('IDX_message_links_chat_created_id', ['chat', 'createdAt', 'id'])
@Index('UQ_message_links_message_url', ['message', 'url'], { unique: true })
export class MessageLink extends BaseEntity {
    @ManyToOne(() => Message, { onDelete: 'CASCADE' })
    message: Message;

    /** Denormalized chat id: the Links tab filters by it without a join. */
    @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
    chat: Chat;

    /** Absolute URL (`https://` added when the text had no scheme). */
    @Column({ type: 'varchar', length: 2048 })
    url: string;

    /** Lowercase hostname without `www.`, used for the emphasized label. */
    @Column({ type: 'varchar', length: 255 })
    domain: string;
}
