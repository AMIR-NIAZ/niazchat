import { DataSource } from 'typeorm';
import { exit } from 'process';

let dataSource: DataSource;

function InitDataSource() {
    if (dataSource) {
        return dataSource;
    }

    dataSource = new DataSource({
        type    : 'mysql',
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT),
        username: process.env.MYSQL_ROOT_USERNAME,
        password: process.env.MYSQL_ROOT_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        synchronize: false,
        dropSchema: false,
        logging: false,
        logger: 'file',
        entities: ['src/**/*.entity.ts'],
    });

    return dataSource;
}

async function runSeeder() {
    await InitDataSource();
    await dataSource.initialize();
    await roleSeeder(dataSource); //* pass
    await PermissionSeeder(dataSource);

    exit(0);
}

runSeeder();