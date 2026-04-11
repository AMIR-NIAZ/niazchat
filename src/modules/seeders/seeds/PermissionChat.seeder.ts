import { DataSource, DeepPartial } from 'typeorm';
import { Seeder } from '../seeder.base';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.entity';
import { PermissionChst } from 'src/modules/chats/entities/permission_chat.entity';

const permissionChats: DeepPartial<PermissionChst[]> = [
    {
        name: PermissionChatEnum.BAN_USER,
    },
    {
        name: PermissionChatEnum.CHANGE_INFO_CHAT,
    },
    {
        name: PermissionChatEnum.DELETE_MESSAGE,
    },
];

export class PermmisionChatSeeder extends Seeder {
    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    async run(options?: { onlyIfEmpty?: boolean }): Promise<void> {
        const PermissionChatRepository =
            this.dataSource.getRepository(PermissionChst);

        if (options?.onlyIfEmpty) {
            console.log('PermissionChat seeder skipped: Data already exists.');
            return;
        }

        console.log('Running PermissionChatSeeder.');

        await PermissionChatRepository.upsert(permissionChats, {
            conflictPaths: ['name'],
        });

        console.log('PermissionChatSeeder finished.');
    }
}
