import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Attachment } from 'src/modules/attachments/entities/attachment.entity';
import { AttachmentService } from 'src/modules/attachments/services/attachment.service';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { RoleChatEnum } from 'src/common/enums/roleChat.enum';
import { Message } from '../entities/message.entity';
import { ForwardMessagesDto } from '../dtos/forwardMessages.dto';
import { ForwardRequestStore } from './forward-request.store';
import { MessageForwardService } from './message-forward.service';

function sourceMessage(id: number, over: Partial<Message> = {}): Message {
    return {
        id,
        content: `message ${id}`,
        type: { id: 1, name: 'text' },
        sender: { id: 5, profile: { name: 'Ali', username: 'ali' } },
        attachments: [],
        forwardedFromUserId: null,
        forwardedFromName: null,
        ...over,
    } as unknown as Message;
}

describe('MessageForwardService', () => {
    let service: MessageForwardService;
    let messageRepository: { find: jest.Mock };
    let memberRepository: { findOne: jest.Mock };
    let attachments: {
        copyFilesForForward: jest.Mock;
        deleteFile: jest.Mock;
    };
    let store: {
        assertRateLimit: jest.Mock;
        runIdempotent: jest.Mock;
    };
    let txMessageSave: jest.Mock;
    let txAttachmentSave: jest.Mock;
    let created: Array<Record<string, unknown>>;
    let nextId: number;

    const dto = (over: Record<string, unknown> = {}): ForwardMessagesDto =>
        ({
            fromChatId: 1,
            messageIds: [1],
            toChatIds: [2],
            requestId: 'req_abcdefgh',
            ...over,
        }) as unknown as ForwardMessagesDto;

    const member = (chatId: number, role: RoleChatEnum, isBan = false) => ({
        chat: { id: chatId, isBan },
        role: { name: role },
    });

    beforeEach(() => {
        nextId = 100;
        created = [];
        messageRepository = { find: jest.fn() };
        memberRepository = {
            findOne: jest.fn(async (options: unknown) => {
                const id = (options as { where: { chat: { id: number } } })
                    .where.chat.id;
                return id === 2
                    ? member(2, RoleChatEnum.BAN)
                    : member(id, RoleChatEnum.USER);
            }),
        };
        txMessageSave = jest.fn(
            async (value: Record<string, unknown>): Promise<unknown> => {
                const saved = {
                    id: nextId,
                    ...value,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    isEdited: false,
                    isDeleted: false,
                    attachments: [],
                };
                nextId += 1;
                created.push(saved);
                return saved;
            },
        );
        txAttachmentSave = jest.fn(async (value) => value);
        attachments = {
            copyFilesForForward: jest.fn(async () => ({
                storageKey: `2/${Math.random()}.jpg`,
                posterPath: null,
            })),
            deleteFile: jest.fn(async () => undefined),
        };
        store = {
            assertRateLimit: jest.fn(async () => undefined),
            runIdempotent: jest.fn(
                async (_key: string, run: () => Promise<unknown>) => ({
                    value: await run(),
                    cached: false,
                }),
            ),
        };

        service = new MessageForwardService(
            messageRepository as never,
            memberRepository as never,
            {
                transaction: jest.fn(
                    async (run: (manager: unknown) => Promise<unknown>) =>
                        run({
                            getRepository: (entity: unknown) =>
                                entity === Message
                                    ? { save: txMessageSave }
                                    : { save: txAttachmentSave },
                        }),
                ),
            } as unknown as DataSource,
            attachments as unknown as AttachmentService,
            store as unknown as ForwardRequestStore,
        );
    });

    function mockSource(rows: Message[]): void {
        messageRepository.find.mockImplementation(async (options: unknown) => {
            const where = (options as { where: Record<string, unknown> }).where;
            if (where['chat'] !== undefined) {
                return rows;
            }
            return created.map((row) => ({
                ...row,
                sender: { id: 1, profile: { name: 'Me' } },
                type: { id: 1, name: 'text' },
            }));
        });
    }

    it('rejects a non-member and a banned source before any transaction', async () => {
        memberRepository.findOne.mockResolvedValueOnce(null);
        await expect(
            service.forward({ sub: 1 } as never, dto()),
        ).rejects.toThrow(ForbiddenException);
        expect(store.runIdempotent).not.toHaveBeenCalled();

        memberRepository.findOne.mockResolvedValueOnce(
            member(1, RoleChatEnum.BAN),
        );
        await expect(
            service.forward({ sub: 1 } as never, dto()),
        ).rejects.toThrow(/banned from the source chat/);

        memberRepository.findOne.mockResolvedValueOnce(
            member(1, RoleChatEnum.USER, true),
        );
        await expect(
            service.forward({ sub: 1 } as never, dto()),
        ).rejects.toThrow(/source chat has been banned/);
    });

    it('rejects missing, deleted or foreign ids as a whole', async () => {
        mockSource([sourceMessage(1)]);
        await expect(
            service.forward({ sub: 1 } as never, dto({ messageIds: [1, 2] })),
        ).rejects.toThrow(/One or more messages/);
        expect(txMessageSave).not.toHaveBeenCalled();
    });

    it('sorts ascending and one banned target does not block the others', async () => {
        mockSource([sourceMessage(3), sourceMessage(1), sourceMessage(2)]);
        const result = await service.forward(
            { sub: 1 } as never,
            dto({ messageIds: [3, 1, 2], toChatIds: [2, 3] }),
        );

        expect(result.data.results).toEqual([
            {
                chatId: 2,
                ok: false,
                message: 'You have been banned from the target chat',
            },
            { chatId: 3, ok: true, messageIds: [100, 101, 102] },
        ]);
        expect(
            (txMessageSave.mock.calls as Array<[Record<string, unknown>]>).map(
                (call) => call[0]['content'],
            ),
        ).toEqual(['message 1', 'message 2', 'message 3']);
    });

    it('keeps the first origin and falls back to username, then empty', async () => {
        mockSource([
            sourceMessage(1, {
                forwardedFromUserId: 9,
                forwardedFromName: 'Original',
                sender: { id: 5, profile: { name: 'Forwarder' } } as never,
            }),
            sourceMessage(2, { sender: null as never }),
        ]);
        await service.forward(
            { sub: 1 } as never,
            dto({ messageIds: [1, 2], toChatIds: [3] }),
        );
        const calls = txMessageSave.mock.calls as Array<
            [Record<string, unknown>]
        >;
        expect(calls[0]?.[0]).toEqual(
            expect.objectContaining({
                forwardedFromUserId: 9,
                forwardedFromName: 'Original',
            }),
        );
        expect(calls[1]?.[0]).toEqual(
            expect.objectContaining({
                forwardedFromUserId: null,
                forwardedFromName: '',
            }),
        );
    });

    it('removes files copied before a target failure', async () => {
        mockSource([
            sourceMessage(1, {
                attachments: [
                    { id: 1, storageKey: '1/a.jpg' },
                    { id: 2, storageKey: '1/b.jpg' },
                ] as never,
            }),
        ]);
        const first = { storageKey: '3/one.jpg', posterPath: null };
        attachments.copyFilesForForward
            .mockResolvedValueOnce(first)
            .mockRejectedValueOnce(
                new BadRequestException('An attachment is no longer available'),
            );

        const result = await service.forward(
            { sub: 1 } as never,
            dto({ toChatIds: [3] }),
        );
        expect(result.data.results[0]).toEqual({
            chatId: 3,
            ok: false,
            message: 'An attachment is no longer available',
        });
        expect(attachments.deleteFile).toHaveBeenCalledWith(
            first.storageKey,
            first.posterPath,
        );
    });

    it('copies attachment metadata and binds each new row to its message', async () => {
        mockSource([
            sourceMessage(1, {
                attachments: [
                    {
                        id: 9,
                        storageKey: '1/a.m4a',
                        posterPath: null,
                        originalName: 'voice.m4a',
                        mimeType: 'audio/mp4',
                        size: 123,
                        width: null,
                        height: null,
                        duration: '4.2',
                        voice: true,
                        waveform: [1, 2],
                    } as never,
                ],
            }),
        ]);
        await service.forward({ sub: 1 } as never, dto({ toChatIds: [3] }));
        expect(txAttachmentSave).toHaveBeenCalledWith(
            expect.objectContaining({
                originalName: 'voice.m4a',
                mimeType: 'audio/mp4',
                size: 123,
                duration: '4.2',
                voice: true,
                waveform: [1, 2],
                message: { id: 100 },
                chat: { id: 3 },
                uploader: { id: 1 },
            }),
        );
        expect(Attachment).toBeDefined();
        expect(ChatMember).toBeDefined();
    });
});
