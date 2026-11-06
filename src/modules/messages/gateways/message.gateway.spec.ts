import { Test, TestingModule } from '@nestjs/testing';
import { MessageGateway } from './message.gateway';
import { MessageService } from '../services/message.service';
import { ChatService } from 'src/modules/chats/services/chat.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtAppService } from 'src/modules/auth/services/jwt.service';
import { JwtService } from '@nestjs/jwt';
import { ChatMember } from 'src/modules/chats/entities/chat_members.entity';
import { RoleChat } from 'src/modules/chats/entities/role_chat.entity';
import {
    CONTENT_HANDLERS,
    ContentResolverService,
} from '../services/content-resolver.service';

describe('MessageGateway', () => {
    let gateway: MessageGateway;
    let messageService: { create: jest.Mock };
    let chatService: { getMemberIds: jest.Mock };
    let roomEmit: jest.Mock;

    beforeEach(async () => {
        messageService = { create: jest.fn() };
        chatService = { getMemberIds: jest.fn().mockResolvedValue([1, 2]) };
        roomEmit = jest.fn();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MessageGateway,
                { provide: MessageService, useValue: messageService },
                { provide: ChatService, useValue: chatService },
                { provide: JwtAppService, useValue: {} },
                { provide: JwtService, useValue: {} },
                { provide: getRepositoryToken(ChatMember), useValue: {} },
                { provide: getRepositoryToken(RoleChat), useValue: {} },
                { provide: CONTENT_HANDLERS, useValue: [] },
                {
                    provide: ContentResolverService,
                    useValue: {
                        resolve: jest.fn((content: string | undefined) =>
                            Promise.resolve(content ?? ''),
                        ),
                    },
                },
            ],
        }).compile();

        gateway = module.get<MessageGateway>(MessageGateway);
        (gateway as unknown as { server: unknown }).server = {
            to: jest.fn().mockReturnValue({ emit: roomEmit }),
            emit: jest.fn(),
        };
    });

    it('should be defined', () => {
        expect(gateway).toBeDefined();
    });

    it('emits sendMessage:list and includes attachment metadata in chat-list previews', async () => {
        const message = {
            id: 100,
            content: '',
            chat: { id: 10 },
            sender: { id: 1 },
            createdAt: new Date('2026-01-01'),
            attachments: [
                {
                    id: 9,
                    originalName: 'doc.pdf',
                    mimeType: 'application/pdf',
                    size: 12,
                },
            ],
        };
        messageService.create.mockResolvedValue(message);

        const client = makeClient();
        await (
            gateway as unknown as {
                sendMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).sendMessage(client, { chatId: 10, type: 'file', attachments: [9] });
        await flushBackgroundWork();

        // Wire shape after the WS standardization: serialized message with
        // numeric ids and top-level chatId/senderId (see ws-serializer.utils).
        expect(roomEmit).toHaveBeenCalledWith(
            'sendMessage:list',
            expect.objectContaining({
                id: 100,
                content: '',
                chatId: 10,
                senderId: 1,
                attachments: [
                    expect.objectContaining({
                        id: 9,
                        originalName: 'doc.pdf',
                        mimeType: 'application/pdf',
                        size: 12,
                    }),
                ],
            }),
        );

        // chatlist:updated is emitted per member room via server.to(userRoom).emit
        expect(roomEmit).toHaveBeenCalledWith('chatlist:updated', {
            chatId: 10,
            lastMessage: {
                id: 100,
                content: '',
                senderId: 1,
                createdAt: message.createdAt,
                attachments: [
                    {
                        id: 9,
                        originalName: 'doc.pdf',
                        mimeType: 'application/pdf',
                        size: 12,
                    },
                ],
            },
        });
        expect(chatService.getMemberIds).toHaveBeenCalledWith(10);
    });

    it('still emits chat-list updates for plain text messages', async () => {
        const message = {
            id: 101,
            content: 'hi',
            chat: { id: 10 },
            sender: { id: 1 },
            createdAt: new Date('2026-01-01'),
            attachments: [],
        };
        messageService.create.mockResolvedValue(message);

        await (
            gateway as unknown as {
                sendMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).sendMessage(
            makeClient(),
            { chatId: 10, content: 'hi', type: 'text' },
        );
        await flushBackgroundWork();

        expect(roomEmit).toHaveBeenCalledWith(
            'chatlist:updated',
            expect.objectContaining({ chatId: 10 }),
        );
    });

    it('emits the echo directly to a sender socket that is not in the room', async () => {
        messageService.create.mockResolvedValue({
            id: 102,
            content: 'hi',
            chat: { id: 10 },
            sender: { id: 1 },
            createdAt: new Date('2026-01-01'),
            attachments: [],
        });

        const client = makeClient([]);
        await (
            gateway as unknown as {
                sendMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).sendMessage(client, { chatId: 10, content: 'hi', type: 'text' });

        expect(client.emit).toHaveBeenCalledWith(
            'sendMessage:list',
            expect.objectContaining({ id: 102, chatId: 10, senderId: 1 }),
        );
    });

    it('does not emit a duplicate echo when the sender is already in the room', async () => {
        messageService.create.mockResolvedValue({
            id: 103,
            content: 'hi',
            chat: { id: 10 },
            sender: { id: 1 },
            createdAt: new Date('2026-01-01'),
            attachments: [],
        });

        const client = makeClient(['chat:10']);
        await (
            gateway as unknown as {
                sendMessage: (
                    client: unknown,
                    dto: unknown,
                ) => Promise<unknown>;
            }
        ).sendMessage(client, { chatId: 10, content: 'hi', type: 'text' });

        expect(client.emit).not.toHaveBeenCalled();
        expect(roomEmit).toHaveBeenCalledWith(
            'sendMessage:list',
            expect.objectContaining({ id: 103 }),
        );
    });

    /** Minimal SocketAuth stand-in: rooms + per-socket emit. */
    function makeClient(rooms: string[] = ['chat:10']) {
        return {
            data: { user: { sub: 1 } },
            rooms: new Set(rooms),
            emit: jest.fn(),
        };
    }

    /** `notifyChatList` is fire-and-forget; let its microtasks run. */
    function flushBackgroundWork(): Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }
});
