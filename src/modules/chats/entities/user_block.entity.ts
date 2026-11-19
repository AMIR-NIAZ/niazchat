import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { Entity, ManyToOne, Unique } from 'typeorm';

/**
 * A directional user block: `blocker` no longer accepts private messages from
 * `blocked`. Blocking is NOT symmetric: the `blocked` user keeps their own
 * relationship with everybody else, and unblocking is just deleting this row.
 *
 * The unique pair makes repeated block requests idempotent under races: a
 * concurrent second insert fails with 23505 and is treated as success.
 */
@Entity('user_blocks')
@Unique('UQ_user_blocks_blocker_blocked', ['blocker', 'blocked'])
export class UserBlock extends BaseEntity {
    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    blocker: User;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    blocked: User;
}
