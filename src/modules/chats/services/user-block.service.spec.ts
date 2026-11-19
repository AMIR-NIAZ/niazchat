import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { UserBlockService } from './user-block.service';

/**
 * Directional block list, at the service boundary:
 *   - blocking/unblocking only touches the caller→peer row and is idempotent,
 *   - every existing-chat write path (`assertCanCommunicate`) and every
 *     user-addressed send (`assertCanMessageUser`) is rejected while blocked,
 *   - groups ignore `user_blocks` entirely,
 *   - only a member of a PRIVATE chat can be targeted (never another chat).
 */
describe('UserBlockService', () => {
    const CHAT_ID = 15;
    const CALLER_ID = 3;
    const PEER_ID = 8;

    interface SetupOptions {
        chat?: { id: number; type: TypeChatEnum; isBan?: boolean } | null;
        members?: Array<{ id: number; user: { id: number } }>;
        state?: { blockedByMe: boolean; blockedMe: boolean };
        isBlockedBetween?: boolean;
    }

    function setup(options: SetupOptions = {}) {
        const inserted: unknown[] = [];
        const deleted: unknown[] = [];
        const inserts: unknown[] = [];
        let insertError: unknown = null;

        const blockRepository = {
            insert: async (row: unknown): Promise<void> => {
                inserts.push(row);
                if (insertError !== null) throw insertError;
            },
            delete: async (criteria: unknown): Promise<void> => {
                deleted.push(criteria);
            },
            query: async (sql: string): Promise<unknown[]> => {
                if (sql.includes('AS "blockedByMe"')) {
                    return [
                        options.state ?? {
                            blockedByMe: false,
                            blockedMe: false,
                        },
                    ];
                }
                if (sql.includes('AS "exists"')) {
                    return [{ exists: options.isBlockedBetween ?? false }];
                }
                // Batch chat-list decoration query.
                return [];
            },
        };

        const chatRepository = {
            findOne: async (): Promise<unknown> =>
                options.chat === undefined
                    ? { id: CHAT_ID, type: TypeChatEnum.PRIVATE, isBan: false }
                    : options.chat,
        };

        const memberRepository = {
            find: async (): Promise<unknown[]> =>
                options.members ?? [
                    { id: 1, user: { id: CALLER_ID } },
                    { id: 2, user: { id: PEER_ID } },
                ],
            findOne: async (): Promise<unknown> => ({ id: 1 }),
        };

        const service = new UserBlockService(
            blockRepository as never,
            chatRepository as never,
            memberRepository as never,
        );

        return {
            service,
            inserts,
            deleted,
            setInsertError: (error: unknown): void => {
                insertError = error;
            },
        };
    }

    it('blocks the peer of a private chat (caller-derived, never client-sent)', async () => {
        const { service, inserts } = setup();
        const result = await service.block(
            CHAT_ID as never,
            CALLER_ID as never,
        );

        expect(inserts).toEqual([
            { blocker: { id: CALLER_ID }, blocked: { id: PEER_ID } },
        ]);
        expect(result).toEqual({
            chatId: CHAT_ID,
            peerId: PEER_ID,
            blockedByMe: false,
            blockedMe: false,
            blocked: false,
        });
    });

    it('treats a duplicate/concurrent block (23505) as success', async () => {
        const { service, setInsertError } = setup();
        setInsertError({ code: '23505' });

        await expect(
            service.block(CHAT_ID as never, CALLER_ID as never),
        ).resolves.toMatchObject({ chatId: CHAT_ID, peerId: PEER_ID });
    });

    it('rethrows unexpected insert failures', async () => {
        const { service, setInsertError } = setup();
        setInsertError(new Error('connection lost'));

        await expect(
            service.block(CHAT_ID as never, CALLER_ID as never),
        ).rejects.toThrow('connection lost');
    });

    it('unblocks by deleting only the caller→peer row (idempotent)', async () => {
        const { service, deleted } = setup();
        await service.unblock(CHAT_ID as never, CALLER_ID as never);

        expect(deleted).toEqual([
            { blocker: { id: CALLER_ID }, blocked: { id: PEER_ID } },
        ]);
    });

    it('rejects blocking in a group chat', async () => {
        const { service } = setup({
            chat: { id: CHAT_ID, type: TypeChatEnum.GRUPE, isBan: false },
        });

        await expect(
            service.block(CHAT_ID as never, CALLER_ID as never),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects blocking a chat the caller does not belong to', async () => {
        const { service } = setup({
            members: [{ id: 2, user: { id: PEER_ID } }],
        });

        await expect(
            service.block(CHAT_ID as never, CALLER_ID as never),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an unknown chat', async () => {
        const { service } = setup({ chat: null });

        await expect(
            service.block(CHAT_ID as never, CALLER_ID as never),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports both directions and the combined state', async () => {
        const { service } = setup({
            state: { blockedByMe: true, blockedMe: true },
        });

        await expect(
            service.getBlockState(CHAT_ID as never, CALLER_ID as never),
        ).resolves.toEqual({
            blockedByMe: true,
            blockedMe: true,
            blocked: true,
        });
    });

    it('stops the caller from sending after they blocked the peer', async () => {
        const { service } = setup({
            state: { blockedByMe: true, blockedMe: false },
        });

        await expect(
            service.assertCanCommunicate(CHAT_ID as never, CALLER_ID as never),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stops a blocked user from sending to the blocker', async () => {
        const { service } = setup({
            state: { blockedByMe: false, blockedMe: true },
        });

        await expect(
            service.assertCanCommunicate(CHAT_ID as never, CALLER_ID as never),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows sending in a private chat with no block row', async () => {
        const { service } = setup({
            state: { blockedByMe: false, blockedMe: false },
        });

        await expect(
            service.assertCanCommunicate(CHAT_ID as never, CALLER_ID as never),
        ).resolves.toBeUndefined();
    });

    it('never blocks writes in a group chat', async () => {
        const { service } = setup({
            chat: { id: CHAT_ID, type: TypeChatEnum.GRUPE, isBan: false },
        });

        await expect(
            service.assertCanCommunicate(CHAT_ID as never, CALLER_ID as never),
        ).resolves.toBeUndefined();
    });

    it('rejects the user-addressed send path while blocked', async () => {
        const { service } = setup({ isBlockedBetween: true });

        await expect(
            service.assertCanMessageUser(CALLER_ID as never, PEER_ID as never),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows the user-addressed send path when no block exists', async () => {
        const { service } = setup({ isBlockedBetween: false });

        await expect(
            service.assertCanMessageUser(CALLER_ID as never, PEER_ID as never),
        ).resolves.toBeUndefined();
    });
});
