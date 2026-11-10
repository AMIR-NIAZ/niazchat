import { User } from 'src/modules/auth/entities/user.entity';
import { Entity, Index, ManyToOne } from 'typeorm';
import { Message } from '../../messages/entities/message.entity';
import { React } from './react.entity';
import { BaseEntity } from 'src/common/entities/base.entity';

@Entity('message_react')
@Index('UQ_message_react_user_message', ['message', 'user'], {
    unique: true,
})
export class MessageReact extends BaseEntity {
    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    user: User;

    @ManyToOne(() => Message, { onDelete: 'CASCADE' })
    message: Message;

    @ManyToOne(() => React, { onDelete: 'CASCADE', eager: true })
    react: React;
}
