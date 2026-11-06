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
import { DataSource } from 'typeorm';
import { JwtPayload } from 'src/common/types/jwt-payload.type';

describe('MessageService (attachment integration)', () => {
    let service: MessageService;
    let messageRepository: {
        save: jest.Mock;
        findOne: jest.Mock;
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
        ).rejects.toThrow(/content is required/);
        expect(transaction).not.toHaveBeenCalled();
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
});

describe('MessageService edit/delete rules (ownership, chat match, state)', () => {
    let service: MessageService;
    let messageRepository: {
        save: jest.Mock;
        findOne: jest.Mock;
        update: jest.Mock;
    };

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
        // The query itself must scope to the chat + sender + not-deleted.
        const findOneMock = messageRepository.findOne as unknown as {
            mock: { calls: Array<Array<{ where: Record<string, unknown> }>> };
        };
        const editArgs = findOneMock.mock.calls[0] ?? [];
        expect(editArgs[0]?.where).toEqual({
            id: 200,
            chat: { id: 10 },
            sender: { id: 1 },
            isDeleted: false,
        });
    });

    it("rejects editing someone else's message (including a mismatched chatId)", async () => {
        messageRepository.findOne.mockResolvedValue(null);

        await expect(
            service.edit(
                { messageId: 200, chatId: 10, newContent: 'mine now' } as never,
                otherUser as never,
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

    it('rejects editing a non-text message', async () => {
        messageRepository.findOne.mockResolvedValue({
            ...ownTextMessage,
            type: { id: 8, name: 'file' },
        });

        await expect(
            service.edit(
                { messageId: 200, chatId: 10, newContent: 'x' } as never,
                user as never,
            ),
        ).rejects.toThrow(/only text messages can be edited/);
        expect(messageRepository.save).not.toHaveBeenCalled();
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

    it("soft-deletes the sender's own message", async () => {
        messageRepository.findOne.mockResolvedValue(ownTextMessage);

        await service.delete(
            { chatId: 10, messageId: 200 } as never,
            user as never,
        );

        expect(messageRepository.update).toHaveBeenCalledWith(200, {
            isDeleted: true,
        });
    });

    it("rejects deleting someone else's message", async () => {
        messageRepository.findOne.mockResolvedValue(null);

        await expect(
            service.delete(
                { chatId: 10, messageId: 200 } as never,
                otherUser as never,
            ),
        ).rejects.toThrow(/message not found/);
        expect(messageRepository.update).not.toHaveBeenCalled();
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
