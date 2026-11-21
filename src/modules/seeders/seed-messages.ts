import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import AppModule from '../app/app.module';
import { ChatService } from '../chats/services/chat.service';
import { MessageService } from '../messages/services/message.service';
import { Chat } from '../chats/entities/chat.entity';
import { ChatMember } from '../chats/entities/chat_members.entity';
import { Message } from '../messages/entities/message.entity';
import { User } from '../auth/entities/user.entity';
import { UserProfile } from '../auth/entities/user_profile.entity';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeMessageEnum } from 'src/common/enums/typeMessage.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import type { ChatId, UserId } from 'src/common/types/brands.type';
import type { JwtPayload } from 'src/common/types/jwt-payload.type';
import {
    LONG_PERSIAN_MESSAGES,
    MULTILINE_PERSIAN_MESSAGES,
    PERSIAN_MESSAGES,
} from './seeds/data/persian-messages';

/**
 * Development-only: append test messages to ONE existing chat so the mobile
 * chat screen's scroll behaviour can be exercised (initial scroll to the bottom
 * vs. to the first unread message).
 *
 *   npm run seed:messages -- --chat 12 --count 30 --read
 *   npm run seed:messages -- --chat 12 --count 40 --viewer demo_ali --unread
 *
 * Everything goes through the real service layer:
 *   - `MessageService.create` writes each message exactly like a socket
 *     `sendMessage` (member/block/permission checks, `type` row, relations);
 *   - `ChatService.markSeen` advances the read position for `--read`.
 *
 * Nothing is deleted and no existing row is modified, except the viewer's own
 * `chat_seen` position in `--read` mode (which is the point of that mode).
 *
 * No Socket.IO event is emitted: the app delivers `sendMessage:list` to the
 * `chat:<id>` room from the RUNNING gateway's server instance, and a separate
 * CLI process has no handle on it (no Redis adapter is installed). The seeded
 * messages therefore appear on the next `getMessages` / reconnect.
 */

const MIN_GAP_SECONDS = 4;
const MAX_GAP_SECONDS = 180;
const MAX_COUNT = 500;
const DEFAULT_COUNT = 30;

type ReadMode = 'read' | 'unread';

interface SeedOptions {
    chatId: number;
    count: number;
    /** The account that will OPEN the chat (owns the read position). */
    viewer: string | null;
    sender: string | null;
    mode: ReadMode;
}

interface Participant {
    id: number;
    label: string;
    roleName: string;
}

interface SeedSummary {
    chatId: number;
    chatType: TypeChatEnum;
    viewer: Participant;
    viewerInferred: boolean;
    sender: Participant;
    created: number;
    firstId: number;
    lastId: number;
    firstAt: Date;
    lastAt: Date;
    mode: ReadMode;
    unreadAfter: number;
    seenChanged: boolean;
}

function parseArgs(): SeedOptions {
    const argv = yargs(hideBin(process.argv))
        .scriptName('seed:messages')
        .usage(
            '$0 --chat <id> --count <n> [--viewer <user>] [--sender <user>] [--read|--unread]',
        )
        .option('chat', {
            type: 'number',
            demandOption: true,
            describe: 'Id of the EXISTING chat to append messages to',
        })
        .option('count', {
            type: 'number',
            default: DEFAULT_COUNT,
            describe: `How many messages to create (1-${MAX_COUNT})`,
        })
        .option('viewer', {
            type: 'string',
            describe:
                'Account that opens the chat and owns the read state (id, username or phone). Defaults to SEED_ME, then to the first active member.',
        })
        .option('sender', {
            type: 'string',
            describe:
                'Message author (id, username or phone). Defaults to the first active member that is not the viewer.',
        })
        .option('read', {
            type: 'boolean',
            describe: 'Mark every seeded message as read for the viewer',
        })
        .option('unread', {
            type: 'boolean',
            describe: 'Leave every seeded message unread for the viewer',
        })
        .conflicts('read', 'unread')
        .check((args) => {
            if (!Number.isInteger(args.chat) || args.chat <= 0) {
                throw new Error('--chat must be a positive integer chat id');
            }
            if (
                !Number.isInteger(args.count) ||
                args.count < 1 ||
                args.count > MAX_COUNT
            ) {
                throw new Error(`--count must be between 1 and ${MAX_COUNT}`);
            }
            return true;
        })
        .strict()
        .alias('h', 'help')
        .parseSync();

    const viewerOption =
        typeof argv.viewer === 'string' && argv.viewer.trim() !== ''
            ? argv.viewer.trim()
            : null;
    const seedMe =
        typeof process.env.SEED_ME === 'string' &&
        process.env.SEED_ME.trim() !== ''
            ? process.env.SEED_ME.trim()
            : null;

    return {
        chatId: argv.chat,
        count: argv.count,
        viewer: viewerOption ?? seedMe,
        sender:
            typeof argv.sender === 'string' && argv.sender.trim() !== ''
                ? argv.sender.trim()
                : null,
        // Default is `--read`: an unexpected badge in the chat list is more
        // confusing than messages that appear already seen.
        mode: argv.unread === true ? 'unread' : 'read',
    };
}

async function main(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'Refusing to seed test messages with NODE_ENV=production. This script is development-only.',
        );
    }

    const options = parseArgs();
    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn'],
    });

    try {
        const dataSource = app.get(DataSource);
        console.log(
            `Seed messages: database=${dataSource.options.database as string} chat=${options.chatId} count=${options.count} mode=${options.mode}`,
        );
        const summary = await seedMessages(
            dataSource,
            app.get(MessageService),
            app.get(ChatService),
            options,
        );
        printSummary(summary);
    } finally {
        // Bull/Redis handles can keep the Nest context alive after the work is
        // committed; close best-effort and exit.
        await Promise.race([
            app.close(),
            new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
    }
}

async function seedMessages(
    dataSource: DataSource,
    messageService: MessageService,
    chatService: ChatService,
    options: SeedOptions,
): Promise<SeedSummary> {
    const chat = await loadChat(dataSource, options.chatId);
    const active = chat.members.filter(
        (member) =>
            (member.role?.name as RoleChatEnum | undefined) !==
            RoleChatEnum.BAN,
    );
    if (active.length === 0) {
        throw new Error(`chat ${options.chatId} has no active members`);
    }

    const { viewer, inferred } = await resolveViewer(
        dataSource,
        active,
        options.viewer,
    );
    const sender = await resolveSender(
        dataSource,
        active,
        options.sender,
        viewer.id,
    );

    const payload: JwtPayload = {
        sub: sender.id as UserId,
        // The services resolve the real role/permissions from the membership
        // row; the payload role is never consulted on this path.
        role: RoleChatEnum.USER,
    };

    const messageRepository = dataSource.getRepository(Message);
    // New history must land after whatever is already in the chat, otherwise a
    // second run could time-travel behind the messages of the first one.
    const newest = await messageRepository.findOne({
        where: { chat: { id: options.chatId as ChatId } },
        select: { id: true, createdAt: true },
        order: { id: 'DESC' },
    });
    const times = buildTimestamps(options.count, newest?.createdAt ?? null);
    const ids: number[] = [];
    const createdTimes: Date[] = [];

    for (let index = 0; index < options.count; index += 1) {
        const at = times[index];
        try {
            const message = await messageService.create(payload, {
                chatId: options.chatId as ChatId,
                content: pickContent(index),
                type: TypeMessageEnum.TEXT,
            });
            const id = Number(message.id);
            // `create` stamps createdAt = now; the seeded history needs the
            // spaced timeline instead. Repository update (no raw SQL).
            await messageRepository.update(id, {
                createdAt: at,
                updatedAt: at,
            });
            ids.push(id);
            createdTimes.push(at);
        } catch (error) {
            const created = ids.length === 0 ? 'none' : `${ids.length}`;
            throw new Error(
                `stopped at message ${index + 1}/${options.count} (created so far: ${created}; ` +
                    `already-written rows are kept): ${describeError(error)}`,
            );
        }
    }

    const firstId = ids[0];
    const lastId = ids[ids.length - 1];

    let seenChanged = false;
    if (options.mode === 'read') {
        // Same writer the socket `seenMessages` handler uses: it validates the
        // id belongs to the chat and never moves the position backwards.
        const result = await chatService.markSeen(
            options.chatId as ChatId,
            viewer.id as UserId,
            lastId,
        );
        seenChanged = result.changed;
    }

    const unread = await chatService.getUnreadCounts(viewer.id as UserId);

    return {
        chatId: options.chatId,
        chatType: chat.type,
        viewer,
        viewerInferred: inferred,
        sender,
        created: ids.length,
        firstId,
        lastId,
        firstAt: createdTimes[0],
        lastAt: createdTimes[createdTimes.length - 1],
        mode: options.mode,
        unreadAfter: unread.get(String(options.chatId)) ?? 0,
        seenChanged,
    };
}

async function loadChat(dataSource: DataSource, chatId: number): Promise<Chat> {
    const chat = await dataSource.getRepository(Chat).findOne({
        where: { id: chatId as ChatId },
        relations: { members: { user: { profile: true }, role: true } },
    });
    if (!chat) {
        throw new Error(`chat ${chatId} was not found`);
    }
    return chat;
}

function toParticipant(member: ChatMember): Participant {
    const user = member.user;
    const username = user.profile?.username;
    const name = user.profile?.name?.trim();
    return {
        id: Number(user.id),
        label:
            `${name || username || user.phone} (#${Number(user.id)}` +
            `${username ? `, @${username}` : ''})`,
        roleName: member.role?.name ?? '',
    };
}

/**
 * The viewer is the account that opens the chat, so it owns the read position.
 * Order: `--viewer`, then `SEED_ME` (the project's usual seeder convention),
 * then the first active member — announced loudly because it is a guess.
 */
async function resolveViewer(
    dataSource: DataSource,
    active: ChatMember[],
    identifier: string | null,
): Promise<{ viewer: Participant; inferred: boolean }> {
    if (identifier === null) {
        const viewer = toParticipant(active[0]);
        console.warn(
            `No --viewer/SEED_ME given: using ${viewer.label} as the viewer (the account whose read state is changed). Pass --viewer to pick another member.`,
        );
        return { viewer, inferred: true };
    }

    const user = await resolveUser(dataSource, identifier);
    if (!user) {
        throw new Error(
            `--viewer '${identifier}' was not found (expected a user id, username or phone)`,
        );
    }
    const member = active.find(
        (candidate) => Number(candidate.user.id) === Number(user.id),
    );
    if (!member) {
        throw new Error(
            `--viewer '${identifier}' is not an active member of this chat`,
        );
    }
    return { viewer: toParticipant(member), inferred: false };
}

/**
 * Messages must come from the OTHER participant. `--sender` wins when given,
 * otherwise the first active member that is not the viewer.
 */
async function resolveSender(
    dataSource: DataSource,
    active: ChatMember[],
    identifier: string | null,
    viewerId: number,
): Promise<Participant> {
    if (identifier !== null) {
        const user = await resolveUser(dataSource, identifier);
        if (!user) {
            throw new Error(
                `--sender '${identifier}' was not found (expected a user id, username or phone)`,
            );
        }
        const member = active.find(
            (candidate) => Number(candidate.user.id) === Number(user.id),
        );
        if (!member) {
            throw new Error(
                `--sender '${identifier}' is not an active member of this chat`,
            );
        }
        if (Number(member.user.id) === viewerId) {
            throw new Error(
                '--sender must be a different member than the viewer (the seeded messages have to come from the other participant)',
            );
        }
        return toParticipant(member);
    }

    const other = active.find(
        (candidate) => Number(candidate.user.id) !== viewerId,
    );
    if (!other) {
        throw new Error(
            'this chat has only one active member: there is no other participant to send from. Pass --sender with a member id.',
        );
    }
    return toParticipant(other);
}

async function resolveUser(
    dataSource: DataSource,
    identifier: string,
): Promise<User | null> {
    const trimmed = identifier.trim();

    if (/^\d+$/.test(trimmed)) {
        const byId = await dataSource.getRepository(User).findOne({
            where: { id: Number(trimmed) as UserId },
            relations: { profile: true },
        });
        if (byId) return byId;
    }

    const profile = await dataSource
        .getRepository(UserProfile)
        .createQueryBuilder('profile')
        .leftJoinAndSelect('profile.user', 'user')
        .where('LOWER(profile.username) = LOWER(:identifier)', {
            identifier: trimmed,
        })
        .getOne();
    if (profile?.user) {
        profile.user.profile = profile;
        return profile.user;
    }

    const phones = phoneVariants(trimmed);
    if (phones.length > 0) {
        const byPhone = await dataSource
            .getRepository(User)
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.profile', 'profile')
            .where('user.phone IN (:...phones)', { phones })
            .getOne();
        if (byPhone) return byPhone;
    }

    return null;
}

/** Iranian mobile formats people tend to paste; mirrors the demo seeder. */
function phoneVariants(identifier: string): string[] {
    const trimmed = identifier.replace(/\s+/g, '');
    if (!/^\+?\d+$/.test(trimmed)) return [];
    const variants = new Set<string>([trimmed]);
    if (trimmed.startsWith('+98')) variants.add(`0${trimmed.slice(3)}`);
    if (trimmed.startsWith('0098')) variants.add(`0${trimmed.slice(4)}`);
    if (trimmed.startsWith('0')) variants.add(`+98${trimmed.slice(1)}`);
    return [...variants];
}

/** Short / multi-line / long, cycled deterministically so heights vary. */
function pickContent(index: number): string {
    const longAt = index % 9 === 4;
    const multilineAt = !longAt && index % 6 === 2;
    if (longAt) {
        return LONG_PERSIAN_MESSAGES[
            Math.floor(index / 9) % LONG_PERSIAN_MESSAGES.length
        ];
    }
    if (multilineAt) {
        return MULTILINE_PERSIAN_MESSAGES[
            Math.floor(index / 6) % MULTILINE_PERSIAN_MESSAGES.length
        ];
    }
    // stride 7 is coprime with 90, so short lines cycle without repeats.
    return PERSIAN_MESSAGES[(index * 7 + 3) % PERSIAN_MESSAGES.length];
}

/**
 * Increasing timestamps, few seconds to three minutes apart. The batch ends at
 * "now" — or later than `latestAt` when the chat already has newer history.
 */
function buildTimestamps(count: number, latestAt: Date | null): Date[] {
    const gaps: number[] = [];
    for (let index = 0; index < count; index += 1) {
        gaps.push(
            MIN_GAP_SECONDS +
                Math.floor(
                    Math.random() * (MAX_GAP_SECONDS - MIN_GAP_SECONDS + 1),
                ),
        );
    }
    const total = gaps.reduce((sum, gap) => sum + gap, 0);
    const now = Date.now();
    const end = Math.max(
        now,
        latestAt === null ? now : latestAt.getTime() + total * 1000 + 1000,
    );
    let cursor = end - total * 1000;
    return gaps.map((gap) => {
        cursor += gap * 1000;
        return new Date(cursor);
    });
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function formatTime(value: Date): string {
    return value.toISOString().replace('T', ' ').slice(0, 19);
}

function printSummary(summary: SeedSummary): void {
    const lines = [
        '',
        '============================================================',
        '  Test messages seeded',
        '============================================================',
        `  Chat          : ${summary.chatId} (${summary.chatType})`,
        `  Viewer        : ${summary.viewer.label}${summary.viewerInferred ? '  [inferred]' : ''}`,
        `  Sender        : ${summary.sender.label}`,
        `  Created       : ${summary.created}`,
        `  First message : id=${summary.firstId}  ${formatTime(summary.firstAt)}`,
        `  Last message  : id=${summary.lastId}  ${formatTime(summary.lastAt)}`,
        `  Mode          : --${summary.mode}` +
            (summary.mode === 'read'
                ? ` (read position ${summary.seenChanged ? 'advanced' : 'already at/after'} ${summary.lastId})`
                : ' (read position untouched)'),
        `  Unread now    : ${summary.unreadAfter} for the viewer`,
        '  Live delivery : none — a CLI process cannot reach the running',
        "                  gateway's Socket.IO server. Reopen the chat or",
        '                  refresh the chat list to fetch the new messages.',
        '============================================================',
        '',
    ];
    console.log(lines.join('\n'));
}

main()
    .then(() => {
        // Give stdout a moment to flush through `docker compose exec`.
        setTimeout(() => process.exit(0), 100);
    })
    .catch((error: unknown) => {
        console.error('Seed messages failed:', describeError(error));
        process.exit(1);
    });
