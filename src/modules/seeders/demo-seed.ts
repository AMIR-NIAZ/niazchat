import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import AppModule from '../app/app.module';
import {
    DemoSeeder,
    type DemoSeedOptions,
    type DemoSeedSummary,
} from './seeds/demo.seeder';

/**
 * Explicit development demo-data entrypoint.
 *
 * NOT wired into the boot seeder registry: `npm run seed:demo` is the only
 * way to run it, and it refuses to touch a production database.
 *
 * Usage (inside the dev container):
 *   SEED_ME=<username-or-phone> npm run seed:demo
 *   SEED_RESET=1 SEED_ME=<username-or-phone> npm run seed:demo
 */
async function main(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'Refusing to run the demo seeder with NODE_ENV=production.',
        );
    }

    const me =
        typeof process.env.SEED_ME === 'string'
            ? process.env.SEED_ME.trim()
            : '';
    if (!me) {
        throw new Error(
            'SEED_ME is required. Example: SEED_ME=demo_ali npm run seed:demo (or use your phone number).',
        );
    }

    const options: DemoSeedOptions = {
        me,
        password:
            typeof process.env.SEED_PASSWORD === 'string'
                ? process.env.SEED_PASSWORD
                : 'Demo@12345',
        reset: process.env.SEED_RESET === '1',
    };

    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn', 'log'],
    });
    try {
        const dataSource = app.get(DataSource);
        console.log(
            `Demo seed: database=${dataSource.options.database as string} me=${options.me} reset=${String(options.reset)}`,
        );
        const seeder = new DemoSeeder(dataSource);
        await seeder.run(options);
        printSummary(seeder.summary);
    } finally {
        // Bull/Redis handles can keep the Nest context alive after the seed.
        // The work is committed at this point, so close best-effort and exit.
        await Promise.race([
            app.close(),
            new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
    }
}

function printSummary(summary: DemoSeedSummary): void {
    const lines = [
        '',
        '============================================================',
        '  Demo seed complete',
        '============================================================',
        `  My account    : ${summary.me.name} (@${summary.me.username || '-'}, ${summary.me.phone}, id=${summary.me.id})`,
        `  Demo users    : ${summary.users.created} created, ${summary.users.existing} already existed`,
        `  Demo groups   : ${summary.groups.created} created, ${summary.groups.existing} already existed`,
        `  Memberships   : ${summary.members} rows added`,
        `  Messages      : ${summary.messages} added (${summary.serviceMessages} service messages)`,
    ];

    if (
        summary.deleted.users +
            summary.deleted.chats +
            summary.deleted.messages >
        0
    ) {
        lines.push(
            `  Reset removed : ${summary.deleted.users} users, ${summary.deleted.chats} groups, ${summary.deleted.messages} messages`,
        );
    }

    lines.push('  My unread     :');
    for (const row of summary.unread) {
        lines.push(`    - ${row.title}: ${row.unread}`);
    }

    lines.push(
        `  Demo password : ${summary.password}`,
        '  Login note    : this project authenticates with phone OTP only (no password column);',
        '                  sign in with the seeded phone number and the dev OTP code 00000.',
        '============================================================',
        '',
    );
    console.log(lines.join('\n'));
}

main()
    .then(() => {
        // Give stdout a moment to flush through `docker compose exec`.
        setTimeout(() => process.exit(0), 100);
    })
    .catch((error: unknown) => {
        console.error(
            'Demo seed failed:',
            error instanceof Error ? error.message : error,
        );
        process.exit(1);
    });
