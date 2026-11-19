import { WsException } from '@nestjs/websockets';
import { PermissionChatEnum } from 'src/common/enums/permissionChat.enum';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { DEFAULT_MEMBER_PERMISSIONS } from 'src/modules/chats/utils/member-permissions.util';
import { MessageService } from './message.service';

/**
 * Pin/unpin contract:
 * - private chats: either participant;
 * - groups: owner always, admin with `pin_messages` (or `all`), regular members
 *   follow the group's `memberPermissions.pin_messages` switch;
 * - the message must belong to the chat and not be deleted;
 * - repeats are idempotent and never write again;
 * - deleting a pinned message clears the pin.
 */
describe('MessageService pinning', () => {
    const user = { sub: 1, role: 'user' };
    const CHAT_ID = 10 as never;
    const MESSAGE_ID = 200 as never;

    let service: MessageService;
    let access: { getCallerContext: jest.Mock };
    let transaction: jest.Mock;
    let txRepository: {
        findOne: jest.Mock;
        update: jest.Mock;
    };
    let messageRepository: {
        findOne: jest.Mock;
        find: jest.Mock;
        update: jest.Mock;
    };
    let reactions: { clearForMessage: jest.Mock };

    function caller(
        over: Partial<{
            type: TypeChatEnum;
            roleName: RoleChatEnum;
            permissions: PermissionChatEnum[];
            isManager: boolean;
            isAdmin: boolean;
            isBan: boolean;
            memberPermissions: Record<string, boolean>;
        }> = {},
    ) {
        return {
            chat: {
                id: CHAT_ID,
                type: over.type ?? TypeChatEnum.PRIVATE,
                isBan: over.isBan ?? false,
                memberPermissions: over.memberPermissions ?? {
                    ...DEFAULT_MEMBER_PERMISSIONS,
                },
            },
            member: { id: 1 },
            roleName: over.roleName ?? RoleChatEnum.USER,
            permissions: over.permissions ?? [],
            isManager: over.isManager ?? false,
            isAdmin: over.isAdmin ?? false,
        };
    }

    beforeEach(() => {
        access = { getCallerContext: jest.fn().mockResolvedValue(caller()) };
        txRepository = {
            findOne: jest.fn(),
            update: jest.fn().mockResolvedValue(undefined),
        };
        transaction = jest.fn(
            (callback: (manager: unknown) => Promise<unknown>) =>
                callback({
                    getRepository: () => txRepository,
                }),
        );
        messageRepository = {
            findOne: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
        };
        reactions = { clearForMessage: jest.fn() };

        service = new MessageService(
            messageRepository as never,
            { findOne: jest.fn() } as never,
            { findOne: jest.fn() } as never,
            { findOneOrFail: jest.fn() } as never,
            { transaction } as never,
            { resolve: jest.fn() } as never,
            {} as never,
            access as never,
            {} as never,
            reactions as never,
            {} as never,
            {} as never,
        );
    });

    function storedMessage(over: Record<string, unknown> = {}) {
        return {
            id: 200,
            chat: { id: 10 },
            type: { id: 1, name: 'text' },
            isDeleted: false,
            isPinned: false,
            pinnedAt: null,
            sender: { id: 1, profile: null },
            attachments: [],
            ...over,
        };
    }

    /**
     * The pin transaction performs two reads: a join-free row lock by primary
     * key, then the relation load. This routes the mock by the presence of
     * `lock` so both calls are satisfied (and so tests can assert the lock
     * query stays relation-free).
     */
    function mockStored(stored = storedMessage()) {
        txRepository.findOne.mockImplementation(
            (options?: { lock?: unknown }) =>
                Promise.resolve(
                    options?.lock
                        ? {
                              id: stored.id,
                              isPinned: stored.isPinned,
                              pinnedAt: stored.pinnedAt,
                          }
                        : stored,
                ),
        );
        return stored;
    }

    it('pins a private-chat message for either participant', async () => {
        const stored = mockStored();
        messageRepository.findOne.mockResolvedValue({
            ...stored,
            isPinned: true,
            pinnedAt: new Date('2026-01-01'),
        });

        const result = await service.pin(
            { chatId: CHAT_ID, messageId: MESSAGE_ID },
            user as never,
        );

        expect(access.getCallerContext).toHaveBeenCalledWith(CHAT_ID, 1);
        expect(result.changed).toBe(true);
        expect(txRepository.update).toHaveBeenCalledWith(MESSAGE_ID, {
            isPinned: true,
            pinnedAt: expect.any(Date) as unknown as Date,
        });
    });

    it('locks only the message row and loads relations without a lock', async () => {
        mockStored();
        messageRepository.findOne.mockResolvedValue(storedMessage());

        await service.pin(
            { chatId: CHAT_ID, messageId: MESSAGE_ID },
            user as never,
        );

        type FindArgs = {
            where: Record<string, unknown>;
            relations?: unknown;
            lock?: unknown;
        };
        const lockArgs = txRepository.findOne.mock.calls[0] as unknown as [
            FindArgs,
        ];
        const relationArgs = txRepository.findOne.mock.calls[1] as unknown as [
            FindArgs,
        ];
        // The lock query must not join relations: PostgreSQL rejects
        // `FOR UPDATE` on the nullable side of an outer join.
        expect(lockArgs[0]).toMatchObject({
            where: { id: MESSAGE_ID, isDeleted: false },
            lock: { mode: 'pessimistic_write' },
        });
        expect(lockArgs[0].relations).toBeUndefined();
        // Relations are read afterwards, inside the same transaction, unlocked.
        expect(relationArgs[0]).toMatchObject({
            where: { id: MESSAGE_ID },
            relations: { type: true, chat: true },
        });
        expect(relationArgs[0].lock).toBeUndefined();
    });

    it('unpins a pinned message and clears pinnedAt', async () => {
        mockStored(
            storedMessage({
                isPinned: true,
                pinnedAt: new Date('2026-01-01'),
            }),
        );

        const result = await service.unpin(
            { chatId: CHAT_ID, messageId: MESSAGE_ID },
            user as never,
        );

        expect(result).toEqual({ messageId: MESSAGE_ID, changed: true });
        expect(txRepository.update).toHaveBeenCalledWith(MESSAGE_ID, {
            isPinned: false,
            pinnedAt: null,
        });
    });

    it('prevents duplicate pin operations (idempotent, no second write)', async () => {
        mockStored(
            storedMessage({
                isPinned: true,
                pinnedAt: new Date('2026-01-01'),
            }),
        );
        messageRepository.findOne.mockResolvedValue(
            storedMessage({ isPinned: true }),
        );

        const result = await service.pin(
            { chatId: CHAT_ID, messageId: MESSAGE_ID },
            user as never,
        );

        expect(result.changed).toBe(false);
        expect(txRepository.update).not.toHaveBeenCalled();
    });

    it('prevents duplicate unpin operations', async () => {
        mockStored();

        const result = await service.unpin(
            { chatId: CHAT_ID, messageId: MESSAGE_ID },
            user as never,
        );

        expect(result.changed).toBe(false);
        expect(txRepository.update).not.toHaveBeenCalled();
    });

    it('serializes concurrent pin requests so only one writes', async () => {
        const stored = mockStored();
        txRepository.update.mockImplementation(
            (_id: unknown, patch: Record<string, unknown>) => {
                Object.assign(stored, patch);
                return Promise.resolve(undefined);
            },
        );
        messageRepository.findOne.mockResolvedValue(stored);

        // Emulate the database's row lock: the second transaction starts only
        // after the first one committed.
        let queue: Promise<unknown> = Promise.resolve();
        transaction.mockImplementation(
            (callback: (manager: unknown) => Promise<unknown>) => {
                const run = queue.then(() =>
                    callback({ getRepository: () => txRepository }),
                );
                queue = run.catch(() => undefined);
                return run;
            },
        );

        const [first, second] = await Promise.all([
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ]);

        expect([first.changed, second.changed].filter(Boolean)).toHaveLength(1);
        expect(txRepository.update).toHaveBeenCalledTimes(1);
    });

    it('rejects a message that belongs to another chat', async () => {
        // The row lock itself only knows the id; ownership is rejected after
        // the relation load, with a neutral error.
        mockStored(storedMessage({ chat: { id: 99 } }));

        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).rejects.toBeInstanceOf(WsException);
        expect(txRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a deleted message even if the lock query matched', async () => {
        mockStored(storedMessage({ isDeleted: true }));

        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).rejects.toBeInstanceOf(WsException);
        expect(txRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a missing message', async () => {
        txRepository.findOne.mockResolvedValue(null);

        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).rejects.toBeInstanceOf(WsException);
        expect(txRepository.update).not.toHaveBeenCalled();
    });

    it('rejects system messages', async () => {
        mockStored(storedMessage({ type: { id: 9, name: 'system' } }));

        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).rejects.toThrow('system messages cannot be pinned');
    });

    it('lets a group owner pin and unpin without a grant', async () => {
        access.getCallerContext.mockResolvedValue(
            caller({
                type: TypeChatEnum.GRUPE,
                roleName: RoleChatEnum.MANAGER,
                isManager: true,
            }),
        );
        txRepository.findOne.mockResolvedValue(storedMessage());
        messageRepository.findOne.mockResolvedValue(storedMessage());

        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).resolves.toMatchObject({ changed: true });
    });

    it('lets an admin pin only with pin_message or all', async () => {
        access.getCallerContext.mockResolvedValue(
            caller({
                type: TypeChatEnum.GRUPE,
                roleName: RoleChatEnum.ADMIN,
                isAdmin: true,
                permissions: [],
            }),
        );

        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).rejects.toBeInstanceOf(WsException);
        expect(transaction).not.toHaveBeenCalled();

        access.getCallerContext.mockResolvedValue(
            caller({
                type: TypeChatEnum.GRUPE,
                roleName: RoleChatEnum.ADMIN,
                isAdmin: true,
                permissions: [PermissionChatEnum.PIN_MESSAGE],
            }),
        );
        txRepository.findOne.mockResolvedValue(storedMessage());
        messageRepository.findOne.mockResolvedValue(storedMessage());

        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).resolves.toMatchObject({ changed: true });
    });

    it('follows the group member policy for pin and unpin', async () => {
        // `pin_messages` is off for members: an explicit admin grant row must
        // not bypass the group policy.
        access.getCallerContext.mockResolvedValue(
            caller({
                type: TypeChatEnum.GRUPE,
                roleName: RoleChatEnum.USER,
                permissions: [PermissionChatEnum.PIN_MESSAGES],
            }),
        );

        await expect(
            service.unpin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).rejects.toBeInstanceOf(WsException);

        access.getCallerContext.mockResolvedValue(
            caller({
                type: TypeChatEnum.GRUPE,
                roleName: RoleChatEnum.USER,
                permissions: [],
                memberPermissions: {
                    ...DEFAULT_MEMBER_PERMISSIONS,
                    pin_messages: true,
                },
            }),
        );
        txRepository.findOne.mockResolvedValue(
            storedMessage({ isPinned: true }),
        );

        await expect(
            service.unpin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).resolves.toMatchObject({ changed: true });
    });

    it('rejects a caller who is not a member of the chat', async () => {
        access.getCallerContext.mockRejectedValue(
            new Error('you are not a member of this group'),
        );

        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).rejects.toThrow('not a member');
        expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects banned members and banned groups', async () => {
        access.getCallerContext.mockResolvedValue(
            caller({
                type: TypeChatEnum.GRUPE,
                roleName: RoleChatEnum.BAN,
            }),
        );
        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).rejects.toBeInstanceOf(WsException);

        access.getCallerContext.mockResolvedValue(
            caller({
                type: TypeChatEnum.GRUPE,
                roleName: RoleChatEnum.MANAGER,
                isManager: true,
                isBan: true,
            }),
        );
        await expect(
            service.pin(
                { chatId: CHAT_ID, messageId: MESSAGE_ID },
                user as never,
            ),
        ).rejects.toBeInstanceOf(WsException);
    });

    it('deleting a pinned message clears its pin state', async () => {
        messageRepository.findOne.mockResolvedValue(
            storedMessage({
                isPinned: true,
                pinnedAt: new Date('2026-01-01'),
                sender: { id: 1 },
            }),
        );

        const result = await service.delete(
            { chatId: CHAT_ID, messageId: MESSAGE_ID } as never,
            user as never,
        );

        expect(result).toEqual({ wasPinned: true });
        expect(messageRepository.update).toHaveBeenCalledWith(MESSAGE_ID, {
            isDeleted: true,
            isPinned: false,
            pinnedAt: null,
        });
        expect(reactions.clearForMessage).toHaveBeenCalledWith(200);
    });

    it('deleting an unpinned message reports wasPinned=false', async () => {
        messageRepository.findOne.mockResolvedValue(
            storedMessage({ sender: { id: 1 } }),
        );

        const result = await service.delete(
            { chatId: CHAT_ID, messageId: MESSAGE_ID } as never,
            user as never,
        );

        expect(result).toEqual({ wasPinned: false });
    });
});
