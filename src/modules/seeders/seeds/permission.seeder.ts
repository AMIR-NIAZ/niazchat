import { DataSource, DeepPartial } from 'typeorm';
import { Seeder } from '../seeder.base';
import { PermissionEnum } from 'src/common/enums/permission.enum';
import { Permission } from 'src/modules/auth/entities/permission.entity';

const permissions: DeepPartial<Permission[]> = [
    {
        name: PermissionEnum.BAN_USER,
    },
    {
        name: PermissionEnum.BAN_CHAT,
    },
    {
        name: PermissionEnum.MANAGE_REACTS,
    },
];

export class PermmisionSeeder extends Seeder {
    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    async run(options?: { onlyIfEmpty?: boolean }): Promise<void> {
        const PermissionRepository = this.dataSource.getRepository(Permission);

        if (options?.onlyIfEmpty) {
            console.log('Permission seeder skipped: Data already exists.');
            return;
        }

        console.log('Running PermissionSeeder.');

        await PermissionRepository.upsert(permissions, {
            conflictPaths: ['name'],
        });

        console.log('PermissionSeeder finished.');
    }
}
