import { BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';

/**
 * Unit coverage for the read-position rules: monotonic writes, clamping,
 * cross-chat rejection, empty chats and the single grouped unread query.
 * (The SQL predicates for own/deleted/missing-row messages are exercised by
 * `scripts/ws-seen.js` against a real database.)
 */

interface SeenRow {
    message: { id: number } | null;
}

interface MockOptions {
    latestId?: number | null;
    messageExists?: boolean;
    txRows?: SeenRow[];
    mySeenMax?: number | null;
}

function queryBuilder(raw: { max: number | null }) {
    const builder = {
        where: () => builder,
        andWhere: () => builder,
        innerJoin: () => builder,
        select: () => builder,
        getRawOne: () => Promise.resolve(raw),
    };
    return builder;
}

function makeService(options: MockOptions = {}) {
    const txRepo = {
        find: jest.fn(() => Promise.resolve(options.txRows ?? [])),
        create: (value: unknown) => value,
        save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    const manager = {
        query: jest.fn(() => Promise.resolve(undefined)),
        getRepository: () => txRepo,
    };
    const seenRepo = {
        manager: {
            transaction: jest.fn(
                (callback: (m: typeof manager) => Promise<unknown>) =>
                    callback(manager),
            ),
        },
        createQueryBuilder: () =>
            queryBuilder({ max: options.mySeenMax ?? null }),
    };
    const messageRepo = {
        findOne: jest.fn(() =>
            Promise.resolve(
                options.latestId === null
                    ? null
                    : { id: options.latestId ?? 80 },
            ),
        ),
        exists: jest.fn(() => Promise.resolve(options.messageExists ?? true)),
    };
    const memberRepo = {
        query: jest.fn(() =>
            Promise.resolve([
                { chatId: '1', count: '12' },
                { chatId: '2', count: '0' },
            ]),
        ),
    };

    const service = new ChatService(
        {} as never,
        memberRepo as never,
        seenRepo as never,
        messageRepo as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
    );

    return { service, seenRepo, txRepo, messageRepo, memberRepo };
}

describe('ChatService.markSeen', () => {
    it('never regresses: an equal/lower id is a no-op', async () => {
        const { service, txRepo } = makeService({
            latestId: 80,
            txRows: [{ message: { id: 70 } }],
        });

        const result = await service.markSeen(1 as never, 2 as never, 60);

        expect(result).toEqual({ lastSeenId: 70, changed: false });
        expect(txRepo.save).not.toHaveBeenCalled();
    });

    it('writes a first seen row for the clamped target', async () => {
        const { service, txRepo } = makeService({
            latestId: 80,
            txRows: [],
        });

        const result = await service.markSeen(1 as never, 2 as never, 42);

        expect(result).toEqual({ lastSeenId: 42, changed: true });
        expect(txRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({ message: { id: 42 } }),
        );
    });

    it('clamps an id above the newest message', async () => {
        const { service, txRepo } = makeService({
            latestId: 80,
            txRows: [],
        });

        const result = await service.markSeen(1 as never, 2 as never, 999);

        expect(result).toEqual({ lastSeenId: 80, changed: true });
        expect(txRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({ message: { id: 80 } }),
        );
    });

    it('rejects an id that is not a message in this chat', async () => {
        const { service, seenRepo } = makeService({
            latestId: 80,
            messageExists: false,
        });

        await expect(
            service.markSeen(1 as never, 2 as never, 40),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(seenRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('treats an empty chat as a no-op (acks 0)', async () => {
        const { service, txRepo } = makeService({ latestId: null });

        await expect(
            service.markSeen(1 as never, 2 as never, 5),
        ).resolves.toEqual({ lastSeenId: 0, changed: false });
        expect(txRepo.save).not.toHaveBeenCalled();
    });
});

describe('ChatService.getUnreadCounts', () => {
    it('runs one grouped query and maps numeric counts', async () => {
        const { service, memberRepo } = makeService();

        const counts = await service.getUnreadCounts(2 as never);

        expect(memberRepo.query).toHaveBeenCalledTimes(1);
        expect(counts.get('1')).toBe(12);
        expect(counts.get('2')).toBe(0);
    });

    it('excludes own and deleted messages and tolerates a missing seen row', async () => {
        const { service, memberRepo } = makeService();

        await service.getUnreadCounts(2 as never);

        const calls = memberRepo.query.mock.calls as unknown[][];
        const firstArgument = calls[0]?.[0];
        const sql = typeof firstArgument === 'string' ? firstArgument : '';
        expect(sql).toContain('"isDeleted" = false');
        expect(sql).toContain('"senderId" <> member."userId"');
        expect(sql).toContain('seen."messageId" IS NULL');
        expect(sql).toContain('GROUP BY member."chatId"');
    });
});
