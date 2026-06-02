import { NestFactory } from '@nestjs/core';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import AppModule from '../../modules/app/app.module';
import { SeederService } from '../../modules/seeders/services/seeder.service';
import { exit } from 'process';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: false,
    });
    const seederService = app.get(SeederService);

    yargs(hideBin(process.argv))
        .command({
            command: 'run <seederName>',
            describe: 'Run a specific seeder',
            builder: (args) =>
                args
                    .positional('seederName', {
                        describe: 'Name of the seeder to run',
                        type: 'string',
                    })
                    .option('opts', {
                        alias: 'o',
                        type: 'string',
                        describe:
                            'JSON object of options to pass to the seeder',
                        coerce: (arg: string) => {
                            try {
                                return JSON.parse(arg);
                            } catch (e) {
                                throw new Error(
                                    `Invalid JSON provided for --opts: ${arg}`,
                                );
                            }
                        },
                    }),
            handler: async (argv) => {
                try {
                    await seederService.runSeeder(
                        argv.seederName as string,
                        argv.opts as Record<string, any>,
                    );
                    console.log('Seeder executed successfully.');
                } catch (error) {
                    console.error('Error executing seeder:', error);
                    process.exit(1);
                } finally {
                    exit(1);
                }
            },
        })
        .command({
            command: 'run-all',
            describe: 'Run all available seeders',
            builder: (args) =>
                args.option('opts', {
                    alias: 'o',
                    type: 'string',
                    describe: 'JSON object of options to pass to all seeders',
                    coerce: (arg: string) => {
                        try {
                            return JSON.parse(arg);
                        } catch (e) {
                            throw new Error(
                                `Invalid JSON provided for --opts: ${arg}`,
                            );
                        }
                    },
                }),
            handler: async (argv) => {
                try {
                    await seederService.runAllSeeders(
                        argv.opts as Record<string, any>,
                    );
                    console.log('All seeders executed successfully.');
                } catch (error) {
                    console.error('Error executing all seeders:', error);
                    process.exit(1);
                } finally {
                    exit(1);
                }
            },
        })
        .command({
            command: 'list',
            describe: 'List all available seeders',
            handler: () => {
                const seeders = seederService.listSeeders();
                console.log('Available seeders:');
                seeders.forEach((seeder) => console.log(`- ${seeder}`));
                exit(1);
            },
        })
        .demandCommand()
        .help()
        .alias('h', 'help')
        .strict()
        .parse();
}

bootstrap();
