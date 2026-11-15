import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';
import { UserId } from 'src/common/types/brands.type';
import { User } from './user.entity';

/**
 * A contact the user SAVED inside the app (not a device address-book entry).
 *
 * `ownerId` is the user who saved it, `contactUserId` the registered account it
 * points to. `alias` is the custom name the owner gave it. `phone` is set only
 * when the contact was saved by phone number: it is the normalized number the
 * owner supplied, which is what allows `GET /contacts` to disclose the phone
 * back to them (and nobody else).
 */
@Entity('contact')
@Unique('UQ_contact_owner_contact_user', ['ownerId', 'contactUserId'])
@Index('IDX_contact_owner', ['ownerId'])
export class Contact {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: number;

    @Column({ type: 'bigint' })
    ownerId: UserId;

    @Column({ type: 'bigint' })
    contactUserId: UserId;

    @Column({ type: 'varchar', length: 60, nullable: true })
    alias: string | null;

    /** E.164 number the owner supplied, null when saved by id/username. */
    @Column({ type: 'varchar', length: 32, nullable: true })
    phone: string | null;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'ownerId' })
    owner: User;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'contactUserId' })
    contactUser: User;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;
}
