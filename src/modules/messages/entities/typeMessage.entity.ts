import { BaseEntity } from 'src/common/entities/base.entity';
import { Column, Entity, OneToMany } from 'typeorm';
import { Message } from './message.entity';

@Entity('type_messages')
export class TypeMessage extends BaseEntity {
    @Column({ unique: true })
    name: string;

    @OneToMany(() => Message, (message) => message.type)
    message: Message;
}
