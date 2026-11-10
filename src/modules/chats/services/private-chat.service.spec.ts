import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Chat } from '../entities/chat.entity';
import { RoleChat } from '../entities/role_chat.entity';
import { PrivateChatService } from './private-chat.service';
import { RateLimitService } from 'src/common/services/rate-limit.service';
import { JwtPayload } from 'src/common/types/jwt-payload.type';

const caller = { sub: 1 } as unknown as JwtPayload;

function build(options: {
    target?: { id: number } | null;
    existing?: { id: number } | null;
    chatRow?: { id: number; isBan: boolean } | null;
    transactionError?: unknown;
}) {
    const chatRepository = {
        findOne: jest
            .fn()
            .mockResolvedValue(
                options.chatRow === undefined
                    ? { id: options.existing?.id ?? 77, isBan: false }
                    : options.chatRow,
            ),
    };
    const roleRepository = {};
    const userRepository = {
        findOne: jest.fn().mockResolvedValue(
            options.target === undefined
                ? {
                      id: 2,
                      isOnline: true,
                      lastSeen: null,
                      profile: {
                          name: 'Sara',
                          username: 'sara',
                          avatars: ['uploads/a.png'],
                      },
                  }
                : options.target,
        ),
    };

    const transactionalChats = {
        findOne: jest.fn().mockResolvedValue(options.existing ?? null),
        save: jest.fn().mockResolvedValue({ id: 77 }),
    };
    const transactionalRoles = {
        findOne: jest.fn().mockResolvedValue({ id: 3, name: 'user' }),
    };
    const transactionalMembers = { insert: jest.fn().mockResolvedValue(null) };
    const manager = {
        getRepository: (entity: unknown) =>
            entity === Chat
                ? transactionalChats
                : entity === RoleChat
                  ? transactionalRoles
                  : transactionalMembers,
    };

    const dataSource = {
        transaction: jest.fn(
            async (run: (m: typeof manager) => Promise<unknown>) => {
                if (options.transactionError !== undefined) {
                    throw options.transactionError as Error;
                }
                return run(manager);
            },
        ),
    };
    const rateLimit = {
        assertUnderLimit: jest.fn().mockResolvedValue(undefined),
        increment: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PrivateChatService(
        chatRepository as never,
        roleRepository as never,
        userRepository as never,
        dataSource as unknown as DataSource,
        rateLimit as unknown as RateLimitService,
    );

    return {
        service,
        chatRepository,
        userRepository,
        transactionalChats,
        transactionalRoles,
        transactionalMembers,
        dataSource,
        rateLimit,
    };
}

describe('PrivateChatService.create', () => {
    it('rejects starting a chat with yourself', async () => {
        const ctx = build({});
        await expect(ctx.service.create(caller, 1)).rejects.toBeInstanceOf(
            BadRequestException,
        );
        await expect(ctx.service.create(caller, 1)).rejects.toThrow(
            "You can't start a chat with yourself",
        );
        expect(ctx.rateLimit.assertUnderLimit).not.toHaveBeenCalled();
    });

    it('rejects a missing or non-active target with the same 404', async () => {
        const ctx = build({ target: null });
        await expect(ctx.service.create(caller, 2)).rejects.toBeInstanceOf(
            NotFoundException,
        );
        await expect(ctx.service.create(caller, 2)).rejects.toThrow(
            'User not found',
        );
    });

    it('creates a chat with both members and counts the creation', async () => {
        const ctx = build({ existing: null });
        const result = await ctx.service.create(caller, 2);

        expect(result).toEqual({
            chatId: 77,
            created: true,
            peer: {
                id: 2,
                name: 'Sara',
                username: 'sara',
                avatars: ['uploads/a.png'],
                isOnline: true,
                lastSeen: null,
            },
        });
        expect(ctx.transactionalMembers.insert).toHaveBeenCalledWith([
            { chat: { id: 77 }, user: { id: 1 }, role: { id: 3 } },
            { chat: { id: 77 }, user: { id: 2 }, role: { id: 3 } },
        ]);
        expect(ctx.rateLimit.increment).toHaveBeenCalledTimes(1);
    });

    it('returns an existing chat and does NOT count it against the limit', async () => {
        const ctx = build({ existing: { id: 5 } });
        const result = await ctx.service.create(caller, 2);

        expect(result.chatId).toBe(5);
        expect(result.created).toBe(false);
        expect(ctx.transactionalMembers.insert).not.toHaveBeenCalled();
        expect(ctx.rateLimit.increment).not.toHaveBeenCalled();
    });

    it('falls back to the existing chat on a 23505 race', async () => {
        const unique = Object.assign(new Error('duplicate key'), {
            code: '23505',
        });
        const ctx = build({
            transactionError: unique,
            chatRow: { id: 88, isBan: false },
        });
        ctx.chatRepository.findOne
            .mockResolvedValueOnce({ id: 88, isBan: false })
            .mockResolvedValueOnce({ id: 88, isBan: false });
        // The fallback lookup uses pairKey on the same repository mock.
        const result = await ctx.service.create(caller, 2);

        expect(result).toEqual({
            chatId: 88,
            created: false,
            peer: expect.objectContaining({ id: 2 }) as unknown,
        });
        expect(ctx.rateLimit.increment).not.toHaveBeenCalled();
    });

    it('rethrows a non-unique transaction failure', async () => {
        const ctx = build({ transactionError: new Error('db down') });
        await expect(ctx.service.create(caller, 2)).rejects.toThrow('db down');
    });

    it('answers a clear error for a banned chat', async () => {
        const ctx = build({
            existing: { id: 5 },
            chatRow: { id: 5, isBan: true },
        });
        await expect(ctx.service.create(caller, 2)).rejects.toThrow(
            'This chat is unavailable',
        );
    });

    it('propagates the 429 before touching the database', async () => {
        const ctx = build({});
        const tooMany = new BadRequestException('too many');
        ctx.rateLimit.assertUnderLimit.mockRejectedValueOnce(tooMany);

        await expect(ctx.service.create(caller, 2)).rejects.toBe(tooMany);
        expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
    });
});
