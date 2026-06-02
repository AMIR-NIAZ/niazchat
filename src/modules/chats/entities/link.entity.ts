import { BaseEntity } from 'src/common/entities/base.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { Chat } from './chat.entity';

@Entity('link')
export class Link extends BaseEntity {
    @Column({ unique: true, length: 20 })
    code: string;

    @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
    chat: Chat;

    @Column({ type: 'int', default: 0 })
    usageLimit: number;

    @Column({ type: 'int', default: 0 })
    usageCount: number;

    @Column({ type: 'timestamp', nullable: true })
    expiresAt: Date | null;

    @Column({ default: true })
    isActive: boolean;
}
