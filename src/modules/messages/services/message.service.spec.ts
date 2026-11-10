import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { MessageService } from './message.service';
import { Message } from '../entities/message.entity';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { Chat } from 'src/modules/chats/entities/chat.entity';
import { User } from 'src/modules/auth/entities/user.entity';
import { TypeMessage } from '../entities/typeMessage.entity';
import { ContentResolverService } from './content-resolver.service';
import { AttachmentService } from 'src/modules/attachments/services/attachment.service';
import { ChatAccessService } from 'src/modules/chats/services/chat-access.service';
import { TypeChatEnum } from 'src/common/enums/typeChat.enum';
import { DataSource } from 'typeorm';
import { JwtPayload } from 'src/common/types/jwt-payload.type';

describe('MessageService (attachment integration)', () => {
    let service: MessageService;
    let messageRepository: {
        save: jest.Mock;
        findOne: jest.Mock;
        find: jest.Mock;
        exists: jest.Mock;
        update: jest.Mock;
    };
    let transaction: jest.Mock;
    let attachmentService: { findUsable: jest.Mock; bindToMessage: jest.Mock };

    const user: JwtPayload = { sub: 1 as never, role: 'user' };
    const typeData = { id: 7, name: 'text' };

    const savedMessage = {
        id: 100,
        content: '',
        chat: { id: 10 },
        type: typeData,
    };

    const fullMessage = {
        ...savedMessage,
        sender: { id: 1, profile: null },
        attachments: [
            {
                id: 9,
                originalName: 'doc.pdf',
                mimeType: 'application/pdf',
                size: 12,
            },
        ],
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        messageRepository = {
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn().mockResolvedValue([]),
            exists: jest.fn(),
            update: jest.fn(),
        };
        transaction = jest.fn();
        attachmentService = { findUsable: jest.fn(), bindToMessage: jest.fn() };

        transaction.mockImplementation(
            (cb: (manager: unknown) => Promise<unknown>) =>
                cb({ getRepository: () => messageRepository } as never),
        );
        messageRepository.save.mockResolvedValue(savedMessage);
        messageRepository.findOne.mockResolvedValue(fullMessage);
        messageRepository.exists.mockResolvedValue(true);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MessageService,
                {
                    provide: getRepositoryToken(Message),
                    useValue: messageRepository,
                },
                {
                    provide: getRepositoryToken(ChatMember),
                    useValue: {
                        findOne: jest.fn().mockResolvedValue({ id: 1 }),
                    },
                },
                {
                    provide: getRepositoryToken(Chat),
                    useValue: { find: jest.fn(), save: jest.fn() },
                },
                {
                    provide: getRepositoryToken(User),
                    useValue: { findOne: jest.fn() },
                },
                {
                    provide: getRepositoryToken(TypeMessage),
                    useValue: {
                        findOneOrFail: jest.fn().mockResolvedValue(typeData),
                    },
                },
                { provide: DataSource, useValue: { transaction } },
                {
                    provide: ContentResolverService,
                    useValue: {
                        resolve: jest.fn((content: string | undefined) =>
                            Promise.resolve(content ?? ''),
                        ),
                    },
                },
                { provide: AttachmentService, useValue: attachmentService },
                {
                    provide: ChatAccessService,
                    useValue: { getCallerContext: jest.fn() },
                },
            ],
        }).compile();

        service = module.get<MessageService>(MessageService);
    });

    it('creates a text-only message without touching attachments', async () => {
        const message = await service.create(
            user as never,
            {
                chatId: 10,
                content: 'hello',
                type: 'text',
            } as never,
        );

        expect(message).toBe(fullMessage);
        expect(attachmentService.findUsable).not.toHaveBeenCalled();
        expect(attachmentService.bindToMessage).not.toHaveBeenCalled();
        expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('creates an attachment-only message with empty content and binds attachments in the transaction', async () => {
        const message = await service.create(
            user as never,
            {
                chatId: 10,
                type: 'file',
                attachments: [9],
            } as never,
        );

        expect(message).toBe(fullMessage);
        expect(attachmentService.findUsable).toHaveBeenCalledWith([9], 1, 10);
        expect(transaction).toHaveBeenCalledTimes(1);
        // The binding must run inside the same transaction callback.
        expect(attachmentService.bindToMessage).toHaveBeenCalledWith(
            expect.anything(),
            [9],
            savedMessage.id,
        );
        expect(messageRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ content: '', chat: { id: 10 } }),
        );
    });

    it('creates a text message with attachments', async () => {
        await service.create(
            user as never,
            {
                chatId: 10,
                content: 'see this',
                type: 'text',
                attachments: [9],
            } as never,
        );

        expect(messageRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'see this' }),
        );
        expect(attachmentService.findUsable).toHaveBeenCalledWith([9], 1, 10);
        expect(attachmentService.bindToMessage).toHaveBeenCalled();
    });

    it('rejects a message with neither text nor attachments', async () => {
        await expect(
            service.create(
                user as never,
                { chatId: 10, type: 'text' } as never,
            ),
        ).rejects.toThrow(/text or at least one attachment/);
        expect(transaction).not.toHaveBeenCalled();
    });

    it('echoes clientMessageId on the returned message without persisting it', async () => {
        const message = await service.create(
            user as never,
            {
                chatId: 10,
                content: '',
                type: 'file',
                attachments: [9],
                clientMessageId: 'c_abc-123',
            } as never,
        );

        expect(
            (message as unknown as { clientMessageId?: string })
                .clientMessageId,
        ).toBe('c_abc-123');
        const saveCalls = messageRepository.save.mock.calls as unknown as Array<
            [Record<string, unknown>]
        >;
        expect(saveCalls[0]?.[0]?.clientMessageId).toBeUndefined();
    });

    it('rejects attachments belonging to another user', async () => {
        attachmentService.findUsable.mockRejectedValue(
            new ForbiddenException('user not access'),
        );

        await expect(
            service.create(
                user as never,
                {
                    chatId: 10,
                    type: 'file',
                    attachments: [9],
                } as never,
            ),
        ).rejects.toThrow(ForbiddenException);
        expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects attachments uploaded for another chat', async () => {
        attachmentService.findUsable.mockRejectedValue(
            new BadRequestException('attachment does not belong to this chat'),
        );

        await expect(
            service.create(
                user as never,
                {
                    chatId: 10,
                    type: 'file',
                    attachments: [9],
                } as never,
            ),
        ).rejects.toThrow(/belong to this chat/);
    });

    it('rejects already-consumed attachments', async () => {
        attachmentService.findUsable.mockRejectedValue(
            new BadRequestException('attachment already used'),
        );

        await expect(
            service.create(
                user as never,
                {
                    chatId: 10,
                    type: 'file',
                    attachments: [9],
                } as never,
            ),
        ).rejects.toThrow(/already used/);
    });

    it('rejects nonexistent attachment ids', async () => {
        attachmentService.findUsable.mockRejectedValue(
            new NotFoundException('attachment not found'),
        );

        await expect(
            service.create(
                user as never,
                {
                    chatId: 10,
                    type: 'file',
                    attachments: [999],
                } as never,
            ),
        ).rejects.toThrow(/attachment not found/);
    });

    it('accepts a voice-only message: one voice attachment, empty text', async () => {
        messageRepository.find.mockResolvedValue([{ id: 9, voice: true }]);

        await service.create(
            user as never,
            {
                chatId: 10,
                content: '',
                type: 'file',
                attachments: [9],
            } as never,
        );

        expect(messageRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ content: '' }),
        );
    });

    it('rejects a voice attachment combined with text', async () => {
        messageRepository.find.mockResolvedValue([{ id: 9, voice: true }]);

        await expect(
            service.create(
                user as never,
                {
                    chatId: 10,
                    content: 'listen to this',
                    type: 'text',
                    attachments: [9],
                } as never,
            ),
        ).rejects.toThrow(/voice messages cannot include text/);
        expect(messageRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a voice attachment combined with another attachment', async () => {
        messageRepository.find.mockResolvedValue([
            { id: 9, voice: true },
            { id: 10, voice: false },
        ]);

        await expect(
            service.create(
                user as never,
                {
                    chatId: 10,
                    content: '',
                    type: 'file',
                    attachments: [9, 10],
                } as never,
            ),
        ).rejects.toThrow(/exactly one attachment/);
        expect(messageRepository.save).not.toHaveBeenCalled();
    });

    it('rejects two voice attachments in one message', async () => {
        messageRepository.find.mockResolvedValue([
            { id: 9, voice: true },
            { id: 10, voice: true },
        ]);

        await expect(
            service.create(
                user as never,
                {
                    chatId: 10,
                    content: '',
                    type: 'file',
                    attachments: [9, 10],
                } as never,
            ),
        ).rejects.toThrow(/exactly one attachment/);
    });

    it('rejects messages whose sender is not a chat member', async () => {
        const module = service as unknown as {
            memberRepository: { findOne: jest.Mock };
        };
        module.memberRepository = {
            findOne: jest.fn().mockResolvedValue(null),
        };

        await expect(
            service.create(
                user as never,
                { chatId: 10, content: 'x', type: 'text' } as never,
            ),
        ).rejects.toThrow(/not exit in chat/);
    });

    it('persists a reply only when the original is in the same chat and not deleted', async () => {
        messageRepository.findOne
            .mockResolvedValueOnce({ id: 77 })
            .mockResolvedValueOnce(fullMessage);

        await service.create(
            user as never,
            {
                chatId: 10,
                content: 'replying',
                type: 'text',
                reply: 77,
            } as never,
        );

        expect(messageRepository.findOne).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                where: { id: 77, chat: { id: 10 }, isDeleted: false },
                select: { id: true },
            }),
        );
        expect(messageRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ replyTo: { id: 77 } }),
        );
    });

    it('rejects a reply when the original is missing, from another chat or deleted', async () => {
        messageRepository.findOne.mockResolvedValueOnce(null);

        await expect(
            service.create(
                user as never,
                {
                    chatId: 10,
                    content: 'replying',
                    type: 'text',
                    reply: 999,
                } as never,
            ),
        ).rejects.toThrow(/reply message not found/);
        expect(transaction).not.toHaveBeenCalled();
    });

    it('treats a non-numeric reply id as no reply', async () => {
        await service.create(
            user as never,
            {
                chatId: 10,
                content: 'plain',
                type: 'text',
                reply: 'abc',
            } as never,
        );

        expect(messageRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({ replyTo: { id: undefined } }),
        );
    });
});

describe('MessageService edit/delete rules (ownership, chat match, state)', () => {
    let service: MessageService;
    let messageRepository: {
        save: jest.Mock;
        findOne: jest.Mock;
        update: jest.Mock;
    };
    let access: { getCallerContext: jest.Mock };

    const user: JwtPayload = { sub: 1 as never, role: 'user' };
    const otherUser: JwtPayload = { sub: 2 as never, role: 'user' };

    const ownTextMessage = {
        id: 200,
        content: 'hello',
        isDeleted: false,
        isEdited: false,
        chat: { id: 10 },
        sender: { id: 1, profile: null },
        type: { id: 7, name: 'text' },
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        messageRepository = {
            save: jest.fn().mockImplementation((m: unknown) => m),
            findOne: jest.fn(),
            update: jest.fn().mockResolvedValue(undefined),
        };
        access = { getCallerContext: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MessageService,
                {
                    provide: getRepositoryToken(Message),
                    useValue: messageRepository,
                },
                { provide: getRepositoryToken(ChatMember), useValue: {} },
                { provide: getRepositoryToken(Chat), useValue: {} },
                { provide: getRepositoryToken(User), useValue: {} },
                { provide: getRepositoryToken(TypeMessage), useValue: {} },
                { provide: DataSource, useValue: { transaction: jest.fn() } },
                {
                    provide: ContentResolverService,
                    useValue: { resolve: jest.fn() },
                },
                { provide: AttachmentService, useValue: {} },
                { provide: ChatAccessService, useValue: access },
            ],
        }).compile();

        service = module.get<MessageService>(MessageService);
    });

    it('lets the sender edit their own text message in the same chat', async () => {
        messageRepository.findOne.mockResolvedValue(ownTextMessage);

        const message = await service.edit(
            { messageId: 200, chatId: 10, newContent: 'hello edited' } as never,
            user as never,
        );

        expect(message.content).toBe('hello edited');
        expect(message.isEdited).toBe(true);
        // The query scopes to the chat + not-deleted; ownership is checked after.
        const findOneMock = messageRepository.findOne as unknown as {
            mock: { calls: Array<Array<{ where: Record<string, unknown> }>> };
        };
        const editArgs = findOneMock.mock.calls[0] ?? [];
        expect(editArgs[0]?.where).toEqual({
            id: 200,
            chat: { id: 10 },
            isDeleted: false,
        });
    });

    it("rejects editing someone else's existing message with a clear error", async () => {
        messageRepository.findOne.mockResolvedValue(ownTextMessage);

        await expect(
            service.edit(
                { messageId: 200, chatId: 10, newContent: 'mine now' } as never,
                otherUser as never,
            ),
        ).rejects.toThrow(/only edit your own messages/);
        expect(messageRepository.save).not.toHaveBeenCalled();
    });

    it('rejects editing a message that is missing or in another chat', async () => {
        messageRepository.findOne.mockResolvedValue(null);

        await expect(
            service.edit(
                { messageId: 200, chatId: 10, newContent: 'x' } as never,
                user as never,
            ),
        ).rejects.toThrow(/message not found/);
        expect(messageRepository.save).not.toHaveBeenCalled();
    });

    it('rejects editing with empty or whitespace-only content', async () => {
        await expect(
            service.edit(
                { messageId: 200, chatId: 10, newContent: '   ' } as never,
                user as never,
            ),
        ).rejects.toThrow(/content is required/);
        expect(messageRepository.findOne).not.toHaveBeenCalled();
    });

    it('rejects editing a forwarded message even when it is own text', async () => {
        messageRepository.findOne.mockResolvedValue({
            ...ownTextMessage,
            forwardedFromUserId: 9,
            forwardedFromName: 'Original',
        });

        await expect(
            service.edit(
                { messageId: 200, chatId: 10, newContent: 'x' } as never,
                user as never,
            ),
        ).rejects.toThrow(/forwarded messages cannot be edited/);
        expect(messageRepository.save).not.toHaveBeenCalled();
    });

    it('edits the caption of an own message with attachments and keeps them', async () => {
        const attachment = {
            id: 9,
            originalName: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 12,
            voice: false,
        };
        messageRepository.findOne.mockResolvedValue({
            ...ownTextMessage,
            content: 'old caption',
            type: { id: 8, name: 'image' },
            attachments: [attachment],
        });

        const message = await service.edit(
            {
                messageId: 200,
                chatId: 10,
                newContent: 'new caption',
            } as never,
            user as never,
        );

        expect(message.content).toBe('new caption');
        expect(message.attachments).toEqual([attachment]);
        expect(messageRepository.save).toHaveBeenCalled();
    });

    it('rejects editing an attachment-only message', async () => {
        messageRepository.findOne.mockResolvedValue({
            ...ownTextMessage,
            content: '',
            type: { id: 8, name: 'image' },
            attachments: [{ id: 9, mimeType: 'image/jpeg', voice: false }],
        });

        await expect(
            service.edit(
                {
                    messageId: 200,
                    chatId: 10,
                    newContent: 'add caption',
                } as never,
                user as never,
            ),
        ).rejects.toThrow(/messages without text cannot be edited/);
        expect(messageRepository.save).not.toHaveBeenCalled();
    });

    it('rejects editing a voice message', async () => {
        messageRepository.findOne.mockResolvedValue({
            ...ownTextMessage,
            type: { id: 9, name: 'voice' },
            attachments: [
                {
                    id: 9,
                    mimeType: 'audio/mp4',
                    voice: true,
                },
            ],
        });

        await expect(
            service.edit(
                { messageId: 200, chatId: 10, newContent: 'x' } as never,
                user as never,
            ),
        ).rejects.toThrow(/voice messages cannot be edited/);
        expect(messageRepository.save).not.toHaveBeenCalled();
    });

    it('rejects editing a text-type message whose attachment is voice', async () => {
        messageRepository.findOne.mockResolvedValue({
            ...ownTextMessage,
            attachments: [
                {
                    id: 9,
                    mimeType: 'audio/mp4',
                    voice: true,
                },
            ],
        });

        await expect(
            service.edit(
                { messageId: 200, chatId: 10, newContent: 'x' } as never,
                user as never,
            ),
        ).rejects.toThrow(/voice messages cannot be edited/);
    });

    it('rejects editing an already-deleted message', async () => {
        messageRepository.findOne.mockResolvedValue(null);

        await expect(
            service.edit(
                { messageId: 200, chatId: 10, newContent: 'x' } as never,
                user as never,
            ),
        ).rejects.toThrow(/message not found/);
    });

    it("soft-deletes the sender's own attachment message", async () => {
        messageRepository.findOne.mockResolvedValue({
            ...ownTextMessage,
            type: { id: 8, name: 'file' },
            attachments: [{ id: 9, mimeType: 'application/pdf', voice: false }],
        });

        await service.delete(
            { chatId: 10, messageId: 200 } as never,
            user as never,
        );

        expect(messageRepository.update).toHaveBeenCalledWith(200, {
            isDeleted: true,
        });
    });

    it("soft-deletes the sender's own text message", async () => {
        messageRepository.findOne.mockResolvedValue(ownTextMessage);

        await service.delete(
            { chatId: 10, messageId: 200 } as never,
            user as never,
        );

        expect(messageRepository.update).toHaveBeenCalledWith(200, {
            isDeleted: true,
        });
    });

    it("rejects deleting someone else's message for members and non-owner admins", async () => {
        messageRepository.findOne.mockResolvedValue({
            ...ownTextMessage,
            sender: { id: 2, profile: null },
        });
        // `isManager` is the chat `manager` role only; a chat admin also gets
        // `false` here, so both cases are covered by the same assertion.
        access.getCallerContext.mockResolvedValue({
            isManager: false,
            chat: { type: TypeChatEnum.GRUPE },
        });

        await expect(
            service.delete(
                { chatId: 10, messageId: 200 } as never,
                user as never,
            ),
        ).rejects.toThrow(/only the group owner/);
        expect(access.getCallerContext).toHaveBeenCalledWith(10, 1);
        expect(messageRepository.update).not.toHaveBeenCalled();
    });

    it("lets the group owner delete another member's message", async () => {
        messageRepository.findOne.mockResolvedValue({
            ...ownTextMessage,
            sender: { id: 2, profile: null },
        });
        access.getCallerContext.mockResolvedValue({
            isManager: true,
            chat: { type: TypeChatEnum.GRUPE },
        });

        await service.delete(
            { chatId: 10, messageId: 200 } as never,
            user as never,
        );

        expect(access.getCallerContext).toHaveBeenCalledWith(10, 1);
        expect(messageRepository.update).toHaveBeenCalledWith(200, {
            isDeleted: true,
        });
    });

    it('rejects deleting an already-deleted message (not idempotent)', async () => {
        messageRepository.findOne.mockResolvedValue(null);

        await expect(
            service.delete(
                { chatId: 10, messageId: 200 } as never,
                user as never,
            ),
        ).rejects.toThrow(/message not found/);
        expect(messageRepository.update).not.toHaveBeenCalled();
    });

    it('finds the newest non-deleted message for a chat-list refresh', async () => {
        messageRepository.findOne.mockResolvedValue({
            id: 300,
            isDeleted: false,
        });

        const last = await service.lastNonDeletedMessage(10 as never);

        expect(last === null ? null : last.id).toBe(300);
        expect(messageRepository.findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { chat: { id: 10 }, isDeleted: false },
                order: { id: 'DESC' },
            }),
        );
    });

    it('returns null for lastNonDeletedMessage on an empty chat', async () => {
        messageRepository.findOne.mockResolvedValue(null);

        await expect(service.lastNonDeletedMessage(10 as never)).resolves.toBe(
            null,
        );
    });
});

describe('MessageService.getPage (cursor pagination)', () => {
    let service: MessageService;
    let messageRepository: { find: jest.Mock };

    interface PageFindArgs {
        where: {
            chat?: { id?: number };
            isDeleted?: boolean;
            id?: { type?: string; value?: number };
        };
        take?: number;
        order?: Record<string, string>;
    }

    const rows = (ids: number[]): Array<{ id: number }> =>
        ids.map((id) => ({ id }));

    const lastFindArgs = (): PageFindArgs => {
        const calls = messageRepository.find.mock.calls as unknown as Array<
            [PageFindArgs]
        >;
        const first = calls[0];
        if (first === undefined) {
            throw new Error('messageRepository.find was not called');
        }
        return first[0];
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        messageRepository = { find: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MessageService,
                {
                    provide: getRepositoryToken(Message),
                    useValue: messageRepository,
                },
                { provide: getRepositoryToken(ChatMember), useValue: {} },
                { provide: getRepositoryToken(Chat), useValue: {} },
                { provide: getRepositoryToken(User), useValue: {} },
                { provide: getRepositoryToken(TypeMessage), useValue: {} },
                { provide: DataSource, useValue: { transaction: jest.fn() } },
                {
                    provide: ContentResolverService,
                    useValue: { resolve: jest.fn() },
                },
                { provide: AttachmentService, useValue: {} },
                {
                    provide: ChatAccessService,
                    useValue: { getCallerContext: jest.fn() },
                },
            ],
        }).compile();

        service = module.get<MessageService>(MessageService);
    });

    it('returns the newest `limit` rows with hasMore and the oldest id as nextCursor', async () => {
        // limit + 1 rows: the extra (oldest) row only signals another page.
        messageRepository.find.mockResolvedValue(
            rows(Array.from({ length: 31 }, (_, index) => 130 - index)),
        );

        const page = await service.getPage(10 as never, undefined, 30);

        expect(page.messages).toHaveLength(30);
        expect(page.messages[0]?.id).toBe(130);
        expect(page.messages[29]?.id).toBe(101);
        expect(page.hasMore).toBe(true);
        expect(page.nextCursor).toBe(101);

        const args = lastFindArgs();
        // Deleted messages are excluded in SQL, not after the fact.
        expect(args.where).toEqual({ chat: { id: 10 }, isDeleted: false });
        expect(args.order).toEqual({ id: 'DESC' });
        expect(args.take).toBe(31);
    });

    it('applies beforeId as a strict id < cursor filter', async () => {
        messageRepository.find.mockResolvedValue(rows([50, 49]));

        const page = await service.getPage(10 as never, 50, 5);

        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBe(49);

        const args = lastFindArgs();
        expect(args.where.id?.type).toBe('lessThan');
        expect(args.where.id?.value).toBe(50);
        expect(args.take).toBe(6);
    });

    it('returns the last page with hasMore false when fewer than limit rows remain', async () => {
        messageRepository.find.mockResolvedValue(rows([5, 4, 3]));

        const page = await service.getPage(10 as never, 6, 5);

        expect(page.messages.map((message) => message.id)).toEqual([5, 4, 3]);
        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBe(3);
    });

    it('returns an empty page with a null cursor', async () => {
        messageRepository.find.mockResolvedValue([]);

        const page = await service.getPage(10 as never, 1, 30);

        expect(page.messages).toEqual([]);
        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBeNull();
    });

    it('defaults to the 30-row page size', async () => {
        messageRepository.find.mockResolvedValue(rows([]));

        await service.getPage(10 as never);

        expect(lastFindArgs().take).toBe(31);
        expect(lastFindArgs().where.id).toBeUndefined();
    });
});
