import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { randomUUID } from 'node:crypto';
import AppModule from '../app/app.module';
import { extractLinks } from 'src/common/utils/link-extractor.util';

/**
 * Development-only bulk data for the chat profile's shared-content tabs.
 *
 *   npm run seed:shared-content -- --chat 12 --each 40
 *   npm run seed:shared-content -- --chat 12 --each 200 --months 12
 *
 * It inserts REAL rows (messages + attachments + message_links) with unique
 * storage keys, spread over the last N months so month headers and pagination
 * (30/60 per page) can be exercised. Rows are written directly (not through
 * MessageService) because there is no file to upload; consequently the media
 * tiles/files have no bytes on disk and their thumbnails render as empty
 * placeholders — layout, counts, cursors, grouping, deletion and realtime all
 * still work. Send a few messages normally to test real playback/preview.
 *
 * Re-running adds more rows (it never deletes anything).
 */

const MIME = {
    image: 'image/jpeg',
    video: 'video/mp4',
    voice: 'audio/mp4',
    music: 'audio/mpeg',
    file: 'application/pdf',
} as const;

const EXT = {
    image: 'jpg',
    video: 'mp4',
    voice: 'm4a',
    music: 'mp3',
    file: 'pdf',
} as const;

const LINK_SAMPLES = [
    'read this https://developer.mozilla.org/en-US/docs/Web/API',
    'nice article: https://react.dev/learn',
    'meeting notes www.notion.so/team',
    'source code https://github.com/nestjs/nest',
    'پروژه جدید https://example.ir/docs',
];

interface Options {
    chatId: number;
    each: number;
    months: number;
}

function parseArgs(): Options {
    const argv = yargs(hideBin(process.argv))
        .scriptName('seed:shared-content')
        .usage('$0 --chat <id> [--each <n>] [--months <n>]')
        .option('chat', { type: 'number', demandOption: true })
        .option('each', { type: 'number', default: 40 })
        .option('months', { type: 'number', default: 6 })
        .strict()
        .parseSync();
    if (!Number.isInteger(argv.chat) || argv.chat <= 0) {
        throw new Error('--chat must be a positive integer');
    }
    return {
        chatId: argv.chat,
        each: Math.min(Math.max(Math.round(argv.each), 1), 500),
        months: Math.min(Math.max(Math.round(argv.months), 1), 36),
    };
}

async function main(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to seed shared content in production.');
    }
    const options = parseArgs();
    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn'],
    });
    try {
        const dataSource = app.get(DataSource);
        console.log(
            `Seed shared content: database=${dataSource.options.database as string} chat=${options.chatId} each=${options.each} months=${options.months}`,
        );
        await seed(dataSource, options);
    } finally {
        await Promise.race([
            app.close(),
            new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
    }
}

async function seed(dataSource: DataSource, options: Options): Promise<void> {
    const sender = await dataSource.query<Array<{ userId: string | number }>>(
        `SELECT cm."userId" AS "userId"
           FROM chat_members cm
           LEFT JOIN role_chat r ON r.id = cm."roleId"
          WHERE cm."chatId" = $1 AND COALESCE(r.name, 'user') <> 'ban'
          ORDER BY cm.id ASC
          LIMIT 1`,
        [options.chatId],
    );
    const senderId = sender[0]?.userId;
    if (senderId === undefined) {
        throw new Error(`chat ${options.chatId} has no active member`);
    }

    const types = await dataSource.query<Array<{ id: number; name: string }>>(
        `SELECT id, name FROM type_messages
          WHERE name IN ('text','image','video','voice','music','file')`,
    );
    const typeId = (name: string): number => {
        const row = types.find((candidate) => candidate.name === name);
        if (row === undefined) {
            throw new Error(`type_messages is missing "${name}" (run seeders)`);
        }
        return row.id;
    };

    const each = options.each;
    let created = 0;
    let links = 0;

    for (let index = 0; index < each; index += 1) {
        const age = ageOf(index, each, options.months);
        // Media: alternating image/video, one attachment per message.
        const isVideo = index % 2 === 1;
        await insertAttachmentMessage(dataSource, {
            chatId: options.chatId,
            senderId,
            typeName: isVideo ? 'video' : 'image',
            typeId: typeId(isVideo ? 'video' : 'image'),
            createdAt: age,
            content: '',
            attachment: {
                kind: isVideo ? 'video' : 'image',
                mime: MIME[isVideo ? 'video' : 'image'],
                ext: EXT[isVideo ? 'video' : 'image'],
                width: 1280,
                height: 960,
                duration: isVideo ? 12 + (index % 40) : null,
            },
        });
        created += 1;

        // Voice message (one voice attachment, no text).
        await insertAttachmentMessage(dataSource, {
            chatId: options.chatId,
            senderId,
            typeName: 'voice',
            typeId: typeId('voice'),
            createdAt: ageOf(index + 0.25, each, options.months),
            content: '',
            attachment: {
                kind: 'voice',
                mime: MIME.voice,
                ext: EXT.voice,
                duration: 3 + (index % 25),
                voice: true,
                waveform: Array.from(
                    { length: 64 },
                    (_, bar) => 15 + ((bar * 7 + index * 11) % 80),
                ),
            },
        });
        created += 1;

        // Music track.
        await insertAttachmentMessage(dataSource, {
            chatId: options.chatId,
            senderId,
            typeName: 'music',
            typeId: typeId('music'),
            createdAt: ageOf(index + 0.5, each, options.months),
            content: '',
            attachment: {
                kind: 'music',
                mime: MIME.music,
                ext: EXT.music,
                duration: 90 + (index % 180),
                title: `Seed track ${index + 1}`,
                artist: index % 3 === 0 ? null : `Seed artist ${index % 5}`,
            },
        });
        created += 1;

        // Generic file (documents tab).
        await insertAttachmentMessage(dataSource, {
            chatId: options.chatId,
            senderId,
            typeName: 'file',
            typeId: typeId('file'),
            createdAt: ageOf(index + 0.75, each, options.months),
            content: '',
            attachment: {
                kind: 'file',
                mime: MIME.file,
                ext: EXT.file,
                size: 120_000 + index * 1_000,
            },
        });
        created += 1;

        // Text message carrying a link (Links tab).
        const content = `${LINK_SAMPLES[index % LINK_SAMPLES.length]} #${
            index + 1
        }`;
        const linkCreatedAt = ageOf(index + 0.9, each, options.months);
        const messageId = await insertMessage(dataSource, {
            chatId: options.chatId,
            senderId,
            typeId: typeId('text'),
            content,
            createdAt: linkCreatedAt,
        });
        const found = extractLinks(content);
        for (const link of found) {
            await dataSource.query(
                `INSERT INTO message_links
                    ("messageId", "chatId", url, domain, "createdAt", "updatedAt")
                 VALUES ($1, $2, $3, $4, $5, $5)
                 ON CONFLICT ("messageId", url) DO NOTHING`,
                [
                    messageId,
                    options.chatId,
                    link.url,
                    link.domain,
                    linkCreatedAt,
                ],
            );
            links += 1;
        }
        created += 1;
    }

    console.log('');
    console.log('============================================================');
    console.log('  Shared-content seed complete');
    console.log('============================================================');
    console.log(`  Messages created : ${created}`);
    console.log(`  Links indexed    : ${links}`);
    console.log(
        '  Thumbnails are placeholders (no bytes on disk); pagination, counts,',
    );
    console.log('  month headers and realtime are fully exercised.');
}

/** Oldest → newest spread across `months`; later indexes are newer. */
function ageOf(index: number, total: number, months: number): Date {
    const now = Date.now();
    const windowMs = months * 30 * 24 * 60 * 60 * 1000;
    const ratio = total <= 1 ? 1 : index / (total - 1);
    return new Date(now - windowMs + ratio * windowMs);
}

async function insertMessage(
    dataSource: DataSource,
    values: {
        chatId: number;
        senderId: string | number;
        typeId: number;
        content: string;
        createdAt: Date;
    },
): Promise<number> {
    const rows = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO messages
            (content, "senderId", "chatId", "typeId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id`,
        [
            values.content,
            values.senderId,
            values.chatId,
            values.typeId,
            values.createdAt,
        ],
    );
    return Number(rows[0]?.id);
}

async function insertAttachmentMessage(
    dataSource: DataSource,
    values: {
        chatId: number;
        senderId: string | number;
        typeName: string;
        typeId: number;
        content: string;
        createdAt: Date;
        attachment: {
            kind: keyof typeof MIME;
            mime: string;
            ext: string;
            size?: number;
            width?: number;
            height?: number;
            duration?: number | null;
            voice?: boolean;
            waveform?: number[];
            title?: string;
            artist?: string | null;
        };
    },
): Promise<void> {
    const messageId = await insertMessage(dataSource, {
        chatId: values.chatId,
        senderId: values.senderId,
        typeId: values.typeId,
        content: values.content,
        createdAt: values.createdAt,
    });
    const attachment = values.attachment;
    const base = Math.max(0, Math.round(attachment.duration ?? 0));
    await dataSource.query(
        `INSERT INTO attachments
            ("originalName", "storageKey", "mimeType", size, width, height,
             duration, voice, waveform, "posterPath", "coverPath", title, artist,
             "durationSeconds", "uploaderId", "chatId", "messageId", status,
             "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, $10, $11,
                 $12, $13, $14, $15, 'attached', $16, $16)`,
        [
            `seed-${values.typeName}-${randomUUID().slice(0, 8)}.${attachment.ext}`,
            `seed-shared/${randomUUID()}.${attachment.ext}`,
            attachment.mime,
            attachment.size ?? 240_000,
            attachment.width ?? null,
            attachment.height ?? null,
            attachment.duration ?? null,
            attachment.voice ?? null,
            attachment.waveform ?? null,
            attachment.title ?? null,
            attachment.artist ?? null,
            attachment.kind === 'music' ? base : null,
            values.senderId,
            values.chatId,
            messageId,
            values.createdAt,
        ],
    );
}

void main().catch((error: unknown): void => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
