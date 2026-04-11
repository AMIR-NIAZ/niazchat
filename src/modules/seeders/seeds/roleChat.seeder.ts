import { DataSource, DeepPartial } from 'typeorm';
import { Seeder } from '../seeder.base';
import { Role } from 'src/modules/auth/entities/role.entity';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';

const roleChats: DeepPartial<Role[]> = [
    {
        name: RoleChatEnum.MANAGER,
    },
    {
        name: RoleChatEnum.ADMIN,
    },
    {
        name: RoleChatEnum.USER,
    },
    {
        name: RoleChatEnum.BAN,
    },
];

export class RoleChatSeeder extends Seeder {
    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    async run(options?: { onlyIfEmpty?: boolean }): Promise<void> {
        const RoleChatRepository = this.dataSource.getRepository(RoleChat);

        if (options?.onlyIfEmpty) {
            console.log('RoleChat seeder skipped: Data already exists.');
            return;
        }

        console.log('Running RoleChatSeeder.');

        await RoleChatRepository.upsert(roleChats, { conflictPaths: ['name'] });

        console.log('RoleChatSeeder finished.');
    }
}
