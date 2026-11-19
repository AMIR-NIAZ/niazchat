import { BaseEntity } from 'src/common/entities/base.entity';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { Message } from 'src/modules/messages/entities/message.entity';
import { Column, Entity, Index, OneToMany, OneToOne } from 'typeorm';
import { ChatSeen } from './chats_seen.entity';
import { ChatMember } from './chat_members.entity';
import { ChatId } from 'src/common/types/brands.type';
import {
    DEFAULT_MEMBER_PERMISSIONS,
    type MemberPermissionsConfig,
} from '../utils/member-permissions.util';

@Entity('chats')
export class Chat extends BaseEntity {
    declare id: ChatId;

    @Column({ nullable: true })
    title?: string;

    /** Group description (nullable; groups only, cleared to NULL). */
    @Column({ type: 'varchar', length: 255, nullable: true })
    description?: string | null;

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

    /**
     * What REGULAR MEMBERS may do in this group (groups only; ignored for
     * private chats). Owners always pass and admins keep using their own
     * `permission_admin` grants. Rows created before the column existed get
     * the centralized defaults from the DB default; reads are normalized so a
     * partial legacy object still behaves like the full contract.
     */
    @Column({
        type: 'jsonb',
        default: () => `'${JSON.stringify(DEFAULT_MEMBER_PERMISSIONS)}'::jsonb`,
    })
    memberPermissions: MemberPermissionsConfig;

    /**
     * Canonical `"<smallerUserId>:<largerUserId>"` for private chats, NULL for
     * groups. The unique index makes one chat per unordered pair enforceable
     * under races (Postgres allows any number of NULLs).
     */
    @Index('UQ_chats_pairKey', { unique: true })
    @Column({ type: 'varchar', length: 40, nullable: true })
    pairKey?: string | null;
}
