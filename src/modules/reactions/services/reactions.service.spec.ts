import { WsException } from '@nestjs/websockets';
import { JwtPayload } from 'src/common/types/jwt-payload.type';
import { MessageReact } from '../entities/message_react.entity';
import { ReactMessageDto } from '../dto/reaction.dto';
import {
    reactionSnapshotForViewer,
    ReactionsService,
} from './reactions.service';

const caller = { sub: 3, role: 'user' } as JwtPayload;

const CATALOG: Record<string, { id: number; name: string; emoji: string }> = {
    '👍': { id: 1, name: 'thumbs_up', emoji: '👍' },
    '❤️': { id: 2, name: 'heart', emoji: '❤️' },
};

function dto(over: Partial<ReactMessageDto> = {}): ReactMessageDto {
    return {
        chatId: 5,
        messageId: 9,
        emoji: '👍',
        ...over,
    } as ReactMessageDto;
}

function build(
    options: {
        message?: unknown;
        existing?: unknown;
        rows?: unknown[];
    } = {},
) {
    const messageRepository = {
        findOne: jest
            .fn()
            .mockResolvedValue(
                options.message === undefined ? { id: 9 } : options.message,
            ),
    };
    const reactRepository = {
        findOne: jest
            .fn()
            .mockImplementation((query: { where: { emoji: string } }) =>
                Promise.resolve(CATALOG[query.where.emoji] ?? null),
            ),
    };
    const messageReactRepository = {
        findOne: jest.fn().mockResolvedValue(options.existing ?? null),
        save: jest.fn().mockResolvedValue({ id: 100 }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
        find: jest.fn().mockResolvedValue(options.rows ?? []),
    };

    const rateLimit = { consume: jest.fn().mockResolvedValue(1) };
    const service = new ReactionsService(
        reactRepository as never,
        messageReactRepository as never,
        messageRepository as never,
        rateLimit as never,
    );

    return {
        service,
        messageRepository,
        reactRepository,
        messageReactRepository,
        rateLimit,
    };
}

describe('ReactionsService.toggle', () => {
    it('adds the first reaction and returns the aggregated snapshot', async () => {
        const ctx = build({
            rows: [{ user: { id: 3 }, react: CATALOG['👍'] }],
        });

        const snapshot = await ctx.service.toggle(dto(), caller);

        expect(ctx.messageRepository.findOne).toHaveBeenCalledWith({
            where: {
                id: 9,
                chat: { id: 5 },
                isDeleted: false,
            },
        });
        expect(ctx.messageReactRepository.save).toHaveBeenCalledWith({
            message: { id: 9 },
            react: { id: 1 },
            user: { id: 3 },
        });
        expect(snapshot).toEqual({
            chatId: 5,
            messageId: 9,
            reactions: [{ reactId: 1, emoji: '👍', count: 1, userIds: [3] }],
            actor: { userId: 3, emoji: '👍' },
            changed: true,
        });
    });

    it('switches an existing reaction to another type', async () => {
        const ctx = build({
            existing: { id: 44, react: CATALOG['👍'] },
            rows: [{ user: { id: 3 }, react: CATALOG['❤️'] }],
        });

        const snapshot = await ctx.service.toggle(dto({ emoji: '❤️' }), caller);

        expect(ctx.messageReactRepository.update).toHaveBeenCalledWith(44, {
            react: { id: 2 },
        });
        expect(ctx.messageReactRepository.save).not.toHaveBeenCalled();
        expect(snapshot.actor).toEqual({ userId: 3, emoji: '❤️' });
        expect(snapshot.reactions[0]?.emoji).toBe('❤️');
    });

    it('toggles the same emoji off', async () => {
        const ctx = build({
            existing: { id: 44, react: CATALOG['👍'] },
        });

        const snapshot = await ctx.service.toggle(dto(), caller);

        expect(ctx.messageReactRepository.delete).toHaveBeenCalledWith(44);
        expect(ctx.messageReactRepository.save).not.toHaveBeenCalled();
        expect(snapshot.actor).toEqual({ userId: 3, emoji: null });
        expect(snapshot.reactions).toEqual([]);
    });

    it('clears the reaction with a null emoji without reading the catalog', async () => {
        const ctx = build({
            existing: { id: 44, react: CATALOG['👍'] },
        });

        await ctx.service.toggle(dto({ emoji: null }), caller);

        expect(ctx.reactRepository.findOne).not.toHaveBeenCalled();
        expect(ctx.messageReactRepository.delete).toHaveBeenCalledWith(44);
    });

    it('treats clearing when nothing was set as a no-op', async () => {
        const ctx = build();

        const snapshot = await ctx.service.toggle(dto({ emoji: null }), caller);

        expect(ctx.messageReactRepository.delete).not.toHaveBeenCalled();
        expect(ctx.messageReactRepository.save).not.toHaveBeenCalled();
        expect(ctx.messageReactRepository.update).not.toHaveBeenCalled();
        expect(snapshot.reactions).toEqual([]);
    });

    it('rejects a message outside the chat or soft-deleted', async () => {
        const ctx = build({ message: null });

        await expect(ctx.service.toggle(dto(), caller)).rejects.toBeInstanceOf(
            WsException,
        );
        await expect(ctx.service.toggle(dto(), caller)).rejects.toThrow(
            'message not found',
        );
        expect(ctx.messageReactRepository.findOne).not.toHaveBeenCalled();
    });

    it('rejects an emoji that is not an active reaction type', async () => {
        const ctx = build();

        await expect(
            ctx.service.toggle(dto({ emoji: '🦄' }), caller),
        ).rejects.toThrow('react not found');
        expect(ctx.messageReactRepository.save).not.toHaveBeenCalled();
    });
});

describe('reactionSnapshotForViewer', () => {
    const snapshot = {
        chatId: 5,
        messageId: 9,
        reactions: [
            { reactId: 1, emoji: '👍', count: 2, userIds: [3, 4] },
            { reactId: 2, emoji: '❤️', count: 1, userIds: [5] },
        ],
        actor: { userId: 3, emoji: '👍' },
    };

    it('marks the viewer own reaction and never exposes userIds', () => {
        expect(reactionSnapshotForViewer(snapshot, 5)).toEqual({
            ...snapshot,
            reactions: [
                { reactId: 1, emoji: '👍', count: 2 },
                { reactId: 2, emoji: '❤️', count: 1 },
            ],
            myReaction: '❤️',
        });
        expect(reactionSnapshotForViewer(snapshot, 4).myReaction).toBe('👍');
    });

    it('uses null when the viewer has no reaction or is unknown', () => {
        expect(reactionSnapshotForViewer(snapshot, 99).myReaction).toBeNull();
        expect(
            reactionSnapshotForViewer(snapshot, undefined).myReaction,
        ).toBeNull();
    });

    it('marks a no-op clear as unchanged', async () => {
        const ctx = build();

        const result = await ctx.service.toggle(
            dto({ emoji: null }),
            caller,
        );

        expect(result.changed).toBe(false);
    });

    it('deduplicates a user and counts each row once', async () => {
        const ctx = build({
            rows: [
                { user: { id: 3 }, react: CATALOG['👍'] },
                { user: { id: 3 }, react: CATALOG['👍'] },
                { user: { id: 4 }, react: CATALOG['👍'] },
            ] as unknown as MessageReact[],
        });

        const result = await ctx.service.toggle(dto(), caller);

        expect(result.reactions).toEqual([
            { reactId: 1, emoji: '👍', count: 3, userIds: [3, 4] },
        ]);
    });
});

describe('ReactionsService page queries', () => {
    function queryBuilder(rawRows: unknown[]) {
        const qb = {
            innerJoin: jest.fn(),
            select: jest.fn(),
            addSelect: jest.fn(),
            where: jest.fn(),
            andWhere: jest.fn(),
            groupBy: jest.fn(),
            addGroupBy: jest.fn(),
            orderBy: jest.fn(),
            addOrderBy: jest.fn(),
            getRawMany: jest.fn().mockResolvedValue(rawRows),
        };
        for (const method of [
            'innerJoin',
            'select',
            'addSelect',
            'where',
            'andWhere',
            'groupBy',
            'addGroupBy',
            'orderBy',
            'addOrderBy',
        ] as const) {
            qb[method].mockReturnThis();
        }
        return qb;
    }

    function makeService(options: {
        summaryRows?: unknown[];
        myRows?: unknown[];
        reactorRows?: unknown[];
        message?: unknown;
    }) {
        const summaryQb = queryBuilder(options.summaryRows ?? []);
        const myQb = queryBuilder(options.myRows ?? []);
        // Each test below issues only one of the two page queries; pick the
        // matching builder so the assertion sees the real call.
        const createQueryBuilder = jest
            .fn()
            .mockReturnValue(
                options.myRows !== undefined ? myQb : summaryQb,
            );
        const messageReactRepository = {
            createQueryBuilder,
            find: jest.fn().mockResolvedValue(options.reactorRows ?? []),
        };
        const messageRepository = {
            findOne: jest
                .fn()
                .mockResolvedValue(
                    options.message === undefined ? { id: 9 } : options.message,
                ),
        };
        const service = new ReactionsService(
            {} as never,
            messageReactRepository as never,
            messageRepository as never,
            { consume: jest.fn() } as never,
        );
        return {
            service,
            summaryQb,
            myQb,
            createQueryBuilder,
            messageReactRepository,
            messageRepository,
        };
    }

    it('loads summaries for the whole page with one grouped query', async () => {
        const ctx = makeService({
            summaryRows: [
                {
                    messageId: '9',
                    reactId: '2',
                    emoji: '❤️',
                    count: '2',
                },
                {
                    messageId: '9',
                    reactId: '1',
                    emoji: '👍',
                    count: '1',
                },
                {
                    messageId: '10',
                    reactId: '1',
                    emoji: '👍',
                    count: '4',
                },
            ],
        });

        const result = await ctx.service.summariesFor([9, 10, 11]);

        expect(ctx.createQueryBuilder).toHaveBeenCalledTimes(1);
        expect(ctx.summaryQb.groupBy).toHaveBeenCalledWith('mr.messageId');
        expect(result.get(9)).toEqual([
            { emoji: '❤️', count: 2 },
            { emoji: '👍', count: 1 },
        ]);
        expect(result.get(10)).toEqual([{ emoji: '👍', count: 4 }]);
        expect(result.get(11)).toBeUndefined();
    });

    it('loads the viewer own reactions for the page with one extra query', async () => {
        const ctx = makeService({
            myRows: [
                { messageId: '9', emoji: '👍' },
                { messageId: '10', emoji: '❤️' },
            ],
        });

        const result = await ctx.service.myReactionsFor([9, 10], 3);

        expect(ctx.createQueryBuilder).toHaveBeenCalledTimes(1);
        expect(ctx.myQb.where).toHaveBeenCalledWith('mr.userId = :userId', {
            userId: 3,
        });
        expect(result.get(9)).toBe('👍');
        expect(result.get(10)).toBe('❤️');
    });

    it('caps the reactor list at 100 users and returns only public fields', async () => {
        const reactorRows = Array.from({ length: 105 }, (_, index) => ({
            id: index + 1,
            user: {
                id: index + 1,
                phone: '09120000000',
                profile: {
                    name: `User ${index + 1}`,
                    username: `user${index + 1}`,
                    avatars: [`/avatars/${index + 1}.webp`],
                },
            },
            react: { id: 1, emoji: '👍' },
        }));
        const ctx = makeService({ reactorRows });

        const groups = await ctx.service.reactorsFor(5, 9);

        expect(ctx.messageReactRepository.find).toHaveBeenCalledWith(
            expect.objectContaining({
                order: { id: 'DESC' },
                take: 100,
            }),
        );
        const users = groups.flatMap((group) => group.users);
        expect(users).toHaveLength(100);
        expect(users[0]).toEqual({
            userId: 1,
            name: 'User 1',
            username: 'user1',
            avatars: ['/avatars/1.webp'],
        });
        expect(JSON.stringify(groups)).not.toContain('phone');
        expect(JSON.stringify(groups)).not.toContain('09120000000');
    });

    it('rejects a reactor list for a deleted or foreign-chat message', async () => {
        const ctx = makeService({ message: null });

        await expect(ctx.service.reactorsFor(5, 9)).rejects.toThrow(
            'message not found',
        );
        expect(ctx.messageReactRepository.find).not.toHaveBeenCalled();
    });
});
