import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { Message } from 'src/modules/messages/entities/message.entity';
import { Chat } from '../entities/chat.entity';
import { ChatMember } from '../entities/chat_members.entity';
import { ChatSeen } from '../entities/chats_seen.entity';
import { PrivateChatService } from './private-chat.service';

/**
 * Private-chat deletion, at the service boundary:
 *   - "for me" writes the caller's own `clearedBeforeId` marker inside a
 *     transaction and never touches the peer's row;
 *   - "for both" deletes the chat row (messages/attachments cascade) only for
 *     a member of a PRIVATE chat, and repeats report success;
 *   - non-members and group ids are rejected before any write.
 */
describe('PrivateChatService deletion', () => {
    const CHAT_ID = 33;
    const CALLER_ID = 4;
    const PEER_ID = 9;

    interface SetupOptions {
        chat?: { id: number; type: TypeChatEnum; isBan: boolean } | null;
        member?: { id: number } | null;
        members?: Array<{ id: number; user: { id: number } }>;
        latestMessageId?: number | null;
        affected?: number;
    }

    function setup(options: SetupOptions = {}) {
        const chatUpdates: unknown[] = [];
        const seenDeletes: unknown[] = [];
        const chatDeletes: unknown[] = [];
        const locks: unknown[][] = [];
        let transactions = 0;

        const manager = {
            query: async (sql: string, params: unknown[]): Promise<void> => {
                expect(sql).toContain('pg_advisory_xact_lock');
                locks.push(params);
            },
            getRepository: (entity: unknown) => {
                if (entity === Message) {
                    return {
                        findOne: async (): Promise<unknown> =>
                            options.latestMessageId === null
                                ? null
                                : { id: options.latestMessageId ?? 55 },
                    };
                }
                if (entity === ChatMember) {
                    return {
                        update: async (
                            criteria: unknown,
                            patch: unknown,
                        ): Promise<void> => {
                            chatUpdates.push({ criteria, patch });
                        },
                    };
                }
                if (entity === ChatSeen) {
                    return {
                        delete: async (criteria: unknown): Promise<void> => {
                            seenDeletes.push(criteria);
                        },
                    };
                }
                if (entity === Chat) {
                    return {
                        delete: async (criteria: unknown): Promise<unknown> => {
                            chatDeletes.push(criteria);
                            return { affected: options.affected ?? 1 };
                        },
                    };
                }
                throw new Error('unexpected repository');
            },
        };

        const chatRepository = {
            findOne: async (): Promise<unknown> =>
                options.chat === undefined
                    ? { id: CHAT_ID, type: TypeChatEnum.PRIVATE, isBan: false }
                    : options.chat,
        };
        const memberRepository = {
            findOne: async (): Promise<unknown> =>
                options.member === undefined ? { id: 1 } : options.member,
            find: async (): Promise<unknown[]> =>
                options.members ?? [
                    { id: 1, user: { id: CALLER_ID } },
                    { id: 2, user: { id: PEER_ID } },
                ],
        };
        const dataSource = {
            transaction: async <T>(
                work: (entityManager: unknown) => Promise<T>,
            ): Promise<T> => {
                transactions += 1;
                return work(manager);
            },
        };

        const service = new PrivateChatService(
            chatRepository as never,
            {} as never,
            {} as never,
            dataSource as never,
            {} as never,
            memberRepository as never,
            { isBlockedBy: () => Promise.resolve(false) } as never,
        );

        return {
            service,
            chatUpdates,
            seenDeletes,
            chatDeletes,
            locks,
            transactionCount: (): number => transactions,
        };
    }

    describe('deleteForMe', () => {
        it("stores the newest message id as the caller's own boundary", async () => {
            const { service, chatUpdates, seenDeletes, locks } = setup();

            const result = await service.deleteForMe(
                CHAT_ID as never,
                CALLER_ID as never,
            );

            expect(result).toEqual({ chatId: CHAT_ID, clearedBeforeId: 55 });
            expect(chatUpdates).toEqual([
                {
                    criteria: {
                        chat: { id: CHAT_ID },
                        user: { id: CALLER_ID },
                    },
                    patch: { clearedBeforeId: 55 },
                },
            ]);
            // Read position behind the boundary is dropped for this member.
            expect(seenDeletes).toEqual([
                { chat: { id: CHAT_ID }, user: { id: CALLER_ID } },
            ]);
            // Concurrent deletes/sends are serialized per chat.
            expect(locks).toEqual([[CHAT_ID]]);
        });

        it('uses a null boundary for a chat with no messages', async () => {
            const { service, chatUpdates } = setup({ latestMessageId: null });

            await expect(
                service.deleteForMe(CHAT_ID as never, CALLER_ID as never),
            ).resolves.toEqual({ chatId: CHAT_ID, clearedBeforeId: null });
            expect(chatUpdates).toEqual([
                {
                    criteria: {
                        chat: { id: CHAT_ID },
                        user: { id: CALLER_ID },
                    },
                    patch: { clearedBeforeId: null },
                },
            ]);
        });

        it('rejects a non-member without writing anything', async () => {
            const { service, transactionCount, chatUpdates } = setup({
                member: null,
            });

            await expect(
                service.deleteForMe(CHAT_ID as never, 999 as never),
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(transactionCount()).toBe(0);
            expect(chatUpdates).toEqual([]);
        });

        it('rejects a group chat', async () => {
            const { service } = setup({
                chat: { id: CHAT_ID, type: TypeChatEnum.GRUPE, isBan: false },
            });

            await expect(
                service.deleteForMe(CHAT_ID as never, CALLER_ID as never),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('rejects an unknown chat', async () => {
            const { service } = setup({ chat: null });

            await expect(
                service.deleteForMe(CHAT_ID as never, CALLER_ID as never),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('deleteForBoth', () => {
        it('deletes the chat and reports both participants', async () => {
            const { service, chatDeletes, locks } = setup();

            const result = await service.deleteForBoth(
                CHAT_ID as never,
                CALLER_ID as never,
            );

            expect(result).toEqual({
                chatId: CHAT_ID,
                memberIds: [CALLER_ID, PEER_ID],
                alreadyDeleted: false,
            });
            expect(chatDeletes).toEqual([
                { id: CHAT_ID, type: TypeChatEnum.PRIVATE },
            ]);
            expect(locks).toEqual([[CHAT_ID]]);
        });

        it('is idempotent for a repeat/concurrent delete', async () => {
            const { service, chatDeletes } = setup({ affected: 0 });

            await expect(
                service.deleteForBoth(CHAT_ID as never, CALLER_ID as never),
            ).resolves.toMatchObject({ alreadyDeleted: true });
            expect(chatDeletes).toHaveLength(1);
        });

        it('reports success without a transaction when the chat is gone', async () => {
            const { service, transactionCount, chatDeletes } = setup({
                chat: null,
            });

            await expect(
                service.deleteForBoth(CHAT_ID as never, CALLER_ID as never),
            ).resolves.toEqual({
                chatId: CHAT_ID,
                memberIds: [],
                alreadyDeleted: true,
            });
            expect(transactionCount()).toBe(0);
            expect(chatDeletes).toEqual([]);
        });

        it('rejects a caller who is not a member (no unrelated chat damage)', async () => {
            const { service, transactionCount, chatDeletes } = setup({
                members: [
                    { id: 1, user: { id: CALLER_ID } },
                    { id: 2, user: { id: PEER_ID } },
                ],
            });

            await expect(
                service.deleteForBoth(CHAT_ID as never, 999 as never),
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(transactionCount()).toBe(0);
            expect(chatDeletes).toEqual([]);
        });

        it('refuses a group chat (private-only operation)', async () => {
            const { service, transactionCount } = setup({
                chat: { id: CHAT_ID, type: TypeChatEnum.GRUPE, isBan: false },
            });

            await expect(
                service.deleteForBoth(CHAT_ID as never, CALLER_ID as never),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(transactionCount()).toBe(0);
        });
    });
});
