import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RoleSeeder } from '../seeds/role.seeder';
import { OwnerSeeder } from '../seeds/Owner.seeder';
import { RoleChatSeeder } from '../seeds/roleChat.seeder';
import { PermmisionChatSeeder } from '../seeds/PermissionChat.seeder';
import { PermmisionSeeder } from '../seeds/permission.seeder';

const SEEDERS = [
    OwnerSeeder,
    RoleSeeder,
    PermmisionSeeder,
    RoleChatSeeder,
    PermmisionChatSeeder,
];

@Injectable()
export class SeederService {
    private readonly logger = new Logger(SeederService.name);

    constructor(private readonly dataSource: DataSource) {}

    async runSeeder(
        seederName: string,
        options?: Record<string, any>,
    ): Promise<void> {
        const SeederClass = SEEDERS.find(
            (Seeder) => Seeder.name === seederName,
        );
        if (!SeederClass) {
            this.logger.error(`Seeder not found: ${seederName}`);
            return;
        }

        const seederInstance = new SeederClass(this.dataSource);

        if (typeof (seederInstance as any).run === 'function') {
            this.logger.log(`Running seeder: ${seederName}`);
            await (seederInstance as any).run(options);
            this.logger.log(`Seeder ${seederName} finished successfully.`);
        } else {
            this.logger.error(
                `Seeder ${seederName} does not have a run method.`,
            );
        }
    }

    async runAllSeeders(options?: Record<string, any>): Promise<void> {
        this.logger.log('Running all seeders...');
        for (const SeederClass of SEEDERS) {
            try {
                await this.runSeeder(SeederClass.name, options);
            } catch (error) {
                this.logger.error(
                    `Failed to run seeder ${SeederClass.name}:`,
                    error,
                );
            }
        }
        this.logger.log('All seeders finished.');
    }

    listSeeders(): string[] {
        return SEEDERS.map((Seeder) => Seeder.name);
    }
}
