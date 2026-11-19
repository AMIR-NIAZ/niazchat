import { User } from 'src/modules/auth/entities/user.entity';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Chat } from './chat.entity';
import { BaseEntity } from 'src/common/entities/base.entity';
import { RoleChat } from './role_chat.entity';

@Entity('chat_members')
export class ChatMember extends BaseEntity {
    @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
    chat: Chat;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    user: User;

    @ManyToOne(() => RoleChat, (role) => role.members)
    role: RoleChat;

    /**
     * One-sided "delete chat for me" marker: every message with
     * `id <= clearedBeforeId` is hidden from THIS member only (nothing is
     * deleted for the other participant). `null` = no deletion.
     *
     * The chat is hidden from this member's list while no message newer than
     * the marker exists, so a new message (either direction) restores it with
     * only the new history — the documented restore policy.
     */
    @Column({ type: 'bigint', nullable: true })
    clearedBeforeId?: number | null;

    /**
     * Who promoted THIS member to admin. `null` for the owner, plain members
     * and legacy admin rows created before this column existed. Admins holding
     * `manage_admins`/`manage_permissions` may only act on their own promotees.
     */
    @Column({ type: 'bigint', nullable: true })
    promotedById?: number | null;

    /** FK relation for `promotedById` (dev synchronize matches production SQL). */
    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'promotedById' })
    promotedBy?: User | null;
}
