import { DataSource } from 'typeorm';
import { Seeder } from '../seeder.base';
import { RoleEnum } from 'src/common/enums/role.enum';
import { User } from '../../auth/entities/user.entity';
import { UserProfile } from '../../auth/entities/user_profile.entity';
import { Role } from '../../auth/entities/role.entity';

const Owner = {
    phone: '09123456789',
    role: RoleEnum.OWNER,
};

export class OwnerSeeder extends Seeder {
    constructor(dataSource: DataSource) {
        super(dataSource);
    }

    async run(options?: { onlyIfEmpty?: boolean }) {
        if (options?.onlyIfEmpty) {
            console.log('User seeder skipped: Data already exists.');
            return;
        }

        console.log('Running UserSeeder...');

        const roleRepository = this.dataSource.getRepository(Role);
        const role = await roleRepository.findOne({
            where: { name: Owner.role },
        });
        if (!role) throw new Error(`role ${Owner.role} not found`);

        await this.dataSource.transaction(async (manager) => {
            const user = await manager.findOne(User, {
                where: { phone: Owner.phone },
                relations: { role: true, profile: true },
            });

            if (user) {
                if (user.role?.name !== Owner.role) {
                    user.role = role;
                    await manager.save(user);
                }

                if (!user.profile) {
                    await manager.save(manager.create(UserProfile, { user }));
                }

                return;
            }

            const newUser = await manager.save(
                manager.create(User, {
                    phone: Owner.phone,
                    role,
                }),
            );
            await manager.save(manager.create(UserProfile, { user: newUser }));
        });

        console.log('UserSeeder finished.');
    }
}
