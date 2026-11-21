import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import AppModule from '../app/app.module';
import { extractLinks } from 'src/common/utils/link-extractor.util';
import { MessageLink } from '../messages/entities/message-link.entity';
import { MessageLinkService } from '../messages/services/message-link.service';

/**
 * One-time (and safely re-runnable) backfill of `message_links` for messages
 * that were sent before link extraction existed.
 *
 *   npm run backfill:links
 *   npm run backfill:links -- --chat 42
 *   npm run backfill:links -- --batch 500 --dry-run
 *
 * Properties:
 *   - idempotent: each message's rows are replaced with the URLs currently in
 *     its body, and `(messageId, url)` is unique, so re-running changes nothing;
 *   - safe: no message is modified, only the new links table;
 *   - also removes links whose message is soft-deleted (deleted for everyone),
 *     healing rows deleted before this table existed.
 *
 * It refuses to run with NODE_ENV=production unless `--force` is passed, so a
 * production backfill is always an explicit decision.
 */

const DEFAULT_BATCH = 500;
const MAX_BATCH = 2000;

interface BackfillOptions {
    chatId: number | null;
    batch: number;
    dryRun: boolean;
    force: boolean;
}

interface MessageRow {
    id: string | number;
    chatId: string | number;
    content: string | null;
    createdAt: Date | string;
}

function parseArgs(): BackfillOptions {
    const argv = yargs(hideBin(process.argv))
        .scriptName('backfill:links')
        .usage('$0 [--chat <id>] [--batch <n>] [--dry-run] [--force]')
        .option('chat', {
            type: 'number',
            describe: 'Only backfill this chat id',
        })
        .option('batch', {
            type: 'number',
            default: DEFAULT_BATCH,
            describe: `Messages read per batch (1-${MAX_BATCH})`,
        })
        .option('dry-run', {
            type: 'boolean',
            default: false,
            describe: 'Extract and report only; write nothing',
        })
        .option('force', {
            type: 'boolean',
            default: false,
            describe: 'Allow running with NODE_ENV=production',
        })
        .strict()
        .parseSync();

    const chatId =
        typeof argv.chat === 'number' && Number.isInteger(argv.chat)
            ? argv.chat
            : null;
    const batch =
        typeof argv.batch === 'number' && Number.isInteger(argv.batch)
            ? Math.min(Math.max(argv.batch, 1), MAX_BATCH)
            : DEFAULT_BATCH;

    return {
        chatId,
        batch,
        dryRun: argv.dryRun === true,
        force: argv.force === true,
    };
}

async function main(): Promise<void> {
    const options = parseArgs();
    if (process.env.NODE_ENV === 'production' && !options.force) {
        throw new Error(
            'Refusing to backfill links with NODE_ENV=production (pass --force to override).',
        );
    }

    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn'],
    });
    try {
        const dataSource = app.get(DataSource);
        const service = new MessageLinkService(
            dataSource.getRepository(MessageLink),
            dataSource,
        );
        console.log(
            `Backfill links: database=${dataSource.options.database as string} chat=${options.chatId ?? 'all'} batch=${options.batch} dryRun=${options.dryRun}`,
        );
        await run(dataSource, service, options);
    } finally {
        await Promise.race([
            app.close(),
            new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
    }
}

async function run(
    dataSource: DataSource,
    service: MessageLinkService,
    options: BackfillOptions,
): Promise<void> {
    let lastId = 0;
    let scanned = 0;
    let written = 0;

    for (;;) {
        const rows = await dataSource.query<MessageRow[]>(
            `SELECT id, "chatId", content, "createdAt"
               FROM messages
              WHERE id > $1
                AND "isDeleted" = false
                AND content IS NOT NULL
                AND length(btrim(content)) > 0
                ${options.chatId === null ? '' : 'AND "chatId" = $3'}
              ORDER BY id ASC
              LIMIT $2`,
            options.chatId === null
                ? [lastId, options.batch]
                : [lastId, options.batch, options.chatId],
        );
        if (rows.length === 0) break;

        for (const row of rows) {
            scanned += 1;
            if (options.dryRun) {
                const found = extractLinks(row.content).length;
                if (found > 0) written += found;
                continue;
            }
            await service.syncForMessage(
                Number(row.id),
                Number(row.chatId),
                row.content,
                new Date(row.createdAt),
            );
            written += 1;
        }

        lastId = Number(rows[rows.length - 1]?.id ?? lastId);
        console.log(`  … scanned ${scanned} messages (last id ${lastId})`);
        if (rows.length < options.batch) break;
    }

    // Heal links of messages deleted for everyone before this table existed.
    const cleared = options.dryRun
        ? 0
        : await service.clearDeletedForChat(options.chatId ?? undefined);

    console.log('');
    console.log('============================================================');
    console.log('  Link backfill complete');
    console.log('============================================================');
    console.log(
        `  Messages scanned : ${scanned}${options.dryRun ? ' (dry run)' : ''}`,
    );
    console.log(
        `  ${options.dryRun ? 'Links found' : 'Messages synced'}     : ${written}`,
    );
    console.log(`  Deleted links cleared: ${cleared}`);
    console.log(
        '  Re-running this command is safe; it never duplicates a link.',
    );
}

void main().catch((error: unknown): void => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
