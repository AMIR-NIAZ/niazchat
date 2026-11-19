import { DataSource, DeepPartial } from 'typeorm';
import { Seeder } from '../seeder.base';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { PermissionChat } from 'src/modules/chats/entities/permission_chat.entity';
import { GROUP_PERMISSIONS } from 'src/modules/chats/utils/group-permissions.util';

/**
 * Every contract key plus the special `all` wildcard. The legacy aliases are
 * not seeded again: existing rows keep working through the read-time
 * normalization; new grants always use the current keys.
 */
const permissionChats: DeepPartial<PermissionChat[]> = [
    { name: PermissionChatEnum.ALL },
    ...GROUP_PERMISSIONS.map((name) => ({ name })),
];

export class PermmisionChatSeeder extends Seeder {
    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    async run(options?: { onlyIfEmpty?: boolean }): Promise<void> {
        const PermissionChatRepository =
            this.dataSource.getRepository(PermissionChat);

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
