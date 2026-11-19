import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { Chat } from './chat.entity';
import type { StoredMemberPermissionOverrides } from '../utils/member-permissions.util';

/**
 * Per-member overrides for REGULAR group members. One row per `(chat, user)`
 * enforced by the unique constraint. Only non-`inherit` keys are stored:
 * `{}` never persists because the service deletes the row when every key is
 * back to inherit, so no empty records accumulate.
 *
 * Owners and admins never have override rows: their effective powers come
 * from their role and the existing admin grant system.
 */
@Entity('chat_member_permission_overrides')
@Unique('UQ_chat_member_permission_overrides_chat_user', ['chat', 'user'])
@Index('IDX_chat_member_permission_overrides_user', ['user'])
export class MemberPermissionOverride extends BaseEntity {
    @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'chatId' })
    chat: Chat;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    /**
     * Validated sparse map, e.g. `{ "send_files": "deny" }`. Missing keys mean
     * `inherit` (the group default). Reads normalize legacy/malformed values.
     */
    @Column({
        type: 'jsonb',
        default: () => `'{}'::jsonb`,
    })
    overrides: StoredMemberPermissionOverrides;
}
