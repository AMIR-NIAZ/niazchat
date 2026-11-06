import { BaseEntity } from 'src/common/entities/base.entity';
import { ChatId } from 'src/common/types/brands.type';
import { Column, Entity, ManyToOne, RelationId } from 'typeorm';
import { Chat } from './chat.entity';

@Entity('link')
export class Link extends BaseEntity {
    @Column({ unique: true, length: 20 })
    code: string;

    @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
    chat: Chat;

    /** Computed FK value (no extra column) — used by the wire serializer. */
    @RelationId((link: Link) => link.chat)
    chatId: ChatId;

    @Column({ type: 'int', default: 0 })
    usageLimit: number;

    @Column({ type: 'int', default: 0 })
    usageCount: number;

    @Column({ type: 'timestamp', nullable: true })
    expiresAt: Date | null;

    @Column({ default: true })
    isActive: boolean;
}
