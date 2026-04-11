import { DataSource } from 'typeorm';

export abstract class Seeder {
    protected constructor(protected readonly dataSource: DataSource) {}

    abstract run(options?: Record<string, any>): Promise<void>;
}
