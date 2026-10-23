import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { join } from 'node:path';

export class TypeOrmConfig implements TypeOrmOptionsFactory {
    createTypeOrmOptions(): TypeOrmModuleOptions {
        return {
            type: (process.env.TYPE_DB as 'postgres') ?? 'postgres',
            host: process.env.HOST_DB ?? 'localhost',
            port: Number(process.env.PORT_DB ?? 5432),
            username: process.env.USERNAME_DB,
            password: process.env.PASSWORD_DB,
            database: process.env.DATABASE_DB,
            autoLoadEntities: process.env.AUTOLOADENTITIES !== 'false',
            synchronize:
                process.env.SYNCHRONIZE === 'true' &&
                process.env.NODE_ENV !== 'production',
        };
    }
}
