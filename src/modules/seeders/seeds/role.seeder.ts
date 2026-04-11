import { DataSource, DeepPartial } from 'typeorm';
import { Seeder } from '../seeder.base';
import { Role } from 'src/modules/auth/entities/role.entity';
import { RoleEnum } from 'src/common/enums/role.enum';

const roles: DeepPartial<Role[]> = [
    {
        name: RoleEnum.OWNER,
    },
    {
        name: RoleEnum.ADMIN,
    },
    {
        name: RoleEnum.USER,
    },
];

export class RoleSeeder extends Seeder {
    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    async run(options?: { onlyIfEmpty?: boolean }): Promise<void> {
        const RoleRepository = this.dataSource.getRepository(Role);

        if (options?.onlyIfEmpty) {
            console.log('Role seeder skipped: Data already exists.');
            return;
        }

        console.log('Running RoleSeeder.');

        await RoleRepository.upsert(roles, { conflictPaths: ['name'] });

        console.log('RoleSeeder finished.');
    }
}
