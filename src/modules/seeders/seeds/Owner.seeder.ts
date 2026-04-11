import { DataSource } from 'typeorm';
import { Seeder } from '../seeder.base';
import { RoleEnum } from 'src/common/enums/role.enum';
import { User } from '../../auth/entities/user.entity';

const Owner = {
    phone: '09123456789',
    role: RoleEnum.OWNER,
};

export class OwnerSeeder extends Seeder {
    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    async run(options?: { onlyIfEmpty?: boolean }) {
        const UserRepository = this.dataSource.getRepository(User);

        if (options?.onlyIfEmpty) {
            console.log('User seeder skipped: Data already exists.');
            return;
        }

        console.log('Running UserSeeder...');

        const isOwner = await UserRepository.findOne({
            where: {
                phone: Owner.phone,
            },
        });
        if (isOwner) {
            isOwner.role.name = RoleEnum.OWNER;
            await UserRepository.save(isOwner);
        }

        await UserRepository.save({
            phone: Owner.phone,
            role: { name: Owner.role },
        });

        console.log('UserSeeder finished.');
    }
}
